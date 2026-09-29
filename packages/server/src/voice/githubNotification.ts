/** Ask GitHub Actions to create a private-audio-free issue for the owner. */
export function githubVoiceNotification(token: string): (submission: { id: string; name: string; clips: number }) => Promise<void> {
  return async ({ id, clips }) => {
    const response = await fetch('https://api.github.com/repos/JoshuaLRay/Sandline/dispatches', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        accept: 'application/vnd.github+json',
        'content-type': 'application/json',
        'x-github-api-version': '2022-11-28',
      },
      body: JSON.stringify({ event_type: 'voice-submission-finished', client_payload: { id, clips } }),
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) throw new Error(`GitHub notification rejected (${response.status})`);
  };
}
