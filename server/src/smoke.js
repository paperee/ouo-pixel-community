// 自检脚本：起临时端口，打 /api/health，断言后退出（CI / 本地验证用）
import { app } from "./index.js";

const server = app.listen(0, async () => {
  const port = server.address().port;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/health`);
    const data = await res.json();
    if (!data.ok) throw new Error("health not ok");
    console.log("SMOKE_OK", JSON.stringify(data));
  } catch (err) {
    console.error("SMOKE_FAIL", err.message);
    process.exitCode = 1;
  } finally {
    server.close();
  }
});
