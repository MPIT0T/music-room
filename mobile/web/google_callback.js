// Google returns the result in the URL fragment: browsers never send it to a server.
const params = new URLSearchParams(location.hash.slice(1));
// Keeps the token out of the history
history.replaceState(null, '', location.pathname);

// BroadcastChannel rather than window.opener: Google's pages cut the link to the
// opener (COOP header), and a channel only reaches pages of this same origin.
const channel = new BroadcastChannel('music-room-google');
channel.postMessage(JSON.stringify({
  state: params.get('state'),
  idToken: params.get('id_token'),
  error: params.get('error'),
}));
channel.close();
window.close();
