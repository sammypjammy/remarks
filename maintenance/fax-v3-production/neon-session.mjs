import {sessionAction} from './neon-cli.mjs';
import {AUTH_FAILURES} from './neon-auth-listener.mjs';

// Operator-only commands. Never imported by the preflight or migration runner.
try {
 const args=process.argv.slice(2);
 if(args.length!==1 || !['auth','logout'].includes(args[0]))throw Error();
 process.exitCode=await sessionAction(args[0]);
}catch(error){console.log(AUTH_FAILURES.includes(error?.message)?error.message:'NEON_CLI_SESSION_FAILED_STOP');process.exitCode=1;}
