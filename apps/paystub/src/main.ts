import { loadEnv } from './config/env';
import { startStub } from './server';

const main = async (): Promise<void> => {
  const env = loadEnv();
  const stub = await startStub(env, {
    onError: (message) => {
      process.stderr.write(`${message}\n`);
    },
  });
  process.stdout.write(`payment stub listening on ${env.PAYSTUB_PORT}\n`);
  const stop = (): void => {
    void stub.stop().then(() => process.exit(0));
  };
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
};

main().catch((error: unknown) => {
  process.stderr.write(
    `payment stub failed: ${error instanceof Error ? (error.stack ?? '') : ''}\n`,
  );
  process.exit(1);
});
