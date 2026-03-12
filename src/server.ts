import app from './index';
import { env } from './config/env';

app.listen(env.port, () => {
  console.log(`TEE Backend running on http://localhost:${env.port}`);
  console.log(`Environment: ${env.nodeEnv}`);
});
