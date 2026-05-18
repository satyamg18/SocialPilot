import { NextResponse } from 'next/server';
import { upsertToken } from '@/lib/db';

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get('code');
  const error = searchParams.get('error');

  if (error) {
    console.error('Facebook OAuth Error:', error);
    return NextResponse.redirect(new URL('/settings?error=facebook_auth_failed', request.url));
  }

  if (!code) {
    return NextResponse.redirect(new URL('/settings?error=no_code_provided', request.url));
  }

  const appId = process.env.FACEBOOK_APP_ID;
  const appSecret = process.env.FACEBOOK_APP_SECRET;
  const redirectUri = `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/api/auth/facebook/callback`;

  try {
    // 1. Exchange code for Short-Lived Access Token
    const tokenResponse = await fetch(`https://graph.facebook.com/v19.0/oauth/access_token?client_id=${appId}&redirect_uri=${encodeURIComponent(redirectUri)}&client_secret=${appSecret}&code=${code}`);
    const tokenData = await tokenResponse.json();

    if (!tokenResponse.ok) {
      console.error('Facebook Token Error:', tokenData);
      throw new Error('Failed to get access token');
    }

    const shortLivedToken = tokenData.access_token;

    // 2. Exchange for Long-Lived User Token (lasts 60 days)
    const longTokenResponse = await fetch(`https://graph.facebook.com/v19.0/oauth/access_token?grant_type=fb_exchange_token&client_id=${appId}&client_secret=${appSecret}&fb_exchange_token=${shortLivedToken}`);
    const longTokenData = await longTokenResponse.json();

    const userToken = longTokenData.access_token || shortLivedToken;
    const expiresIn = longTokenData.expires_in || 5184000;
    const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();

    // 3. Fetch the Facebook Pages the user manages
    const pagesResponse = await fetch(`https://graph.facebook.com/v19.0/me/accounts?access_token=${userToken}`);
    const pagesData = await pagesResponse.json();

    if (!pagesData.data || pagesData.data.length === 0) {
      throw new Error('No Facebook Pages found for this user. You need a Facebook Page to publish.');
    }

    // Use the first page (user can change later)
    const page = pagesData.data[0];
    const pageAccessToken = page.access_token;
    const pageId = page.id;
    const pageName = page.name;

    // 4. Save Page Access Token to Database
    await upsertToken('facebook', {
      access_token: pageAccessToken,
      refresh_token: null,
      user_id: pageId,
      user_name: pageName,
      expires_at: expiresAt,
    });

    return NextResponse.redirect(new URL('/settings?success=facebook_connected', request.url));

  } catch (err) {
    console.error('Facebook Callback Exception:', err);
    return NextResponse.redirect(new URL('/settings?error=facebook_callback_failed', request.url));
  }
}
