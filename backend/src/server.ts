import app from "./app.js";

const port = Number(process.env.PORT ?? 3001);
const host = process.env.HOST?.trim() || "127.0.0.1";

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("PORT must be a valid TCP port.");
}

app.listen(port, host, () => {
  console.log(`Haleview backend listening on port ${port}`);
});
