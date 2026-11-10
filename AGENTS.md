# Environment Access Skills

Keep skills self-contained in skills/. Owner instructions should describe one selected handoff route as a short sequence; technical alternatives belong in references.

Never commit customer data, real credentials, generated handoff packages, private/public recipient identities or received ciphertext. Use synthetic values for tests. Private keys and decrypted outputs must remain outside Git. One exception: `receive --dotenv` may write into an env file inside a checkout only when Git ignores that file and does not track it; the tool checks both, refuses symlinks and writes it with mode 0600. Private keys and `--out` files never go inside a checkout. Do not print decrypted files or put secrets in arguments.

Run npm test after code changes. stack-setup tests replay recorded, synthetic CLI/API output only; never add a test that calls a real provider, and keep real stack.yaml/state.json files in each app's own repo, not here. Run npm run test:browser when the offline page changes and python3 tests/tty.test.py when terminal input changes. Platform documentation checks are separate from actual customer integration. A handoff does not authorize external sending, payments, deployment or repository writes.
