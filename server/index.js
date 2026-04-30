import express from 'express';
import axios from 'axios';

const app = express();
const port = process.env.PORT || 5000;

app.use(express.json());

app.get('/health', (_request, response) => {
  response.json({ ok: true, service: 'beatmaps-server' });
});

app.get('/api/spotify/audio-features/:trackId', async (request, response) => {
  const authorization = request.headers.authorization;

  if (!authorization) {
    response.status(401).json({ error: 'Missing Spotify authorization header' });
    return;
  }

  try {
    const spotifyResponse = await axios.get(
      `https://api.spotify.com/v1/audio-features/${request.params.trackId}`,
      { headers: { Authorization: authorization } },
    );
    response.json(spotifyResponse.data);
  } catch (error) {
    response.status(error.response?.status || 500).json({
      error: 'Spotify tempo request failed',
      detail: error.response?.data || error.message,
    });
  }
});

app.listen(port, () => {
  console.log(`BeatMaps server listening on port ${port}`);
});
