// Facebook Graph API Integration
// Docs: https://developers.facebook.com/docs/graph-api/

const FB_GRAPH_BASE = 'https://graph.facebook.com/v19.0';

export async function createFacebookTextPost(accessToken, pageId, text) {
  const res = await fetch(`${FB_GRAPH_BASE}/${pageId}/feed`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: text,
      access_token: accessToken,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Facebook post failed: ${err}`);
  }

  const data = await res.json();
  return { postId: data.id, success: true };
}

export async function createFacebookImagePost(accessToken, pageId, text, imageUrl) {
  const res = await fetch(`${FB_GRAPH_BASE}/${pageId}/photos`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      url: imageUrl,
      caption: text,
      access_token: accessToken,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Facebook image post failed: ${err}`);
  }

  const data = await res.json();
  return { postId: data.id, success: true };
}
