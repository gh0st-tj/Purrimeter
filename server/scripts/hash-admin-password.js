const argon2 = require('argon2');

async function main() {
  const password = process.argv[2];
  if (!password) {
    console.error('Usage: npm run hash-admin-password -- "your-long-admin-password"');
    process.exit(1);
  }
  console.log(await argon2.hash(password, { type: argon2.argon2id }));
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
