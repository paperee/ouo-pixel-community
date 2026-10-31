// 登录/注册页：模板 + 表单提交
import { login, migrateGuestDraft, register } from "../api.js";

export function pageAuth(mode) {
  const isLogin = mode === "login";
  return `
    <main class="wrap narrow">
      <div class="px-card auth-hero">
        <div class="auth-pixels" aria-hidden="true"><i style="background:var(--accent)"></i><i style="background:var(--sky)"></i><i style="background:#2eb5a8"></i><i style="background:#f5a623"></i></div>
        <h1 class="px-title">${isLogin ? "欢迎回家" : "加入OuO社区"}</h1>
        <p class="hint">${isLogin ? "嘿，来瞧瞧是谁上课（上班）还想过来摸鱼？" : "登录后即可享用云端草稿和作品发布（笑死没有更多了…）"}</p>
        <div class="row">
          <span class="px-badge">简易画布</span>
          <span class="px-badge">云端草稿</span>
          <span class="px-badge">作品社区</span>
        </div>
      </div>
      <form id="auth-form" class="px-card stack">
        ${
          isLogin
            ? ""
            : `<input class="px-input" name="nickname" maxlength="20" placeholder="昵称（会有人不填吗）" />`
        }
        <input class="px-input" name="email" type="email" required placeholder="邮箱（不许不填）" />
        <input class="px-input" name="password" type="password" required minlength="6" placeholder="密码（至少 6 位）" />
        <button class="px-btn px-btn--cherry" type="submit">${isLogin ? "登录" : "注册"}</button>
        <p class="err" id="auth-err"></p>
        <p class="hint">${
          isLogin
            ? `没账号？<a href="#/register">快点去注册</a>`
            : `有账号了？<a href="#/login">快点去登录</a>`
        }</p>
      </form>
    </main>`;
}

// auth 表单提交绑定（原 render() 尾部内联逻辑）
export function wireAuthForm(hash) {
  const form = document.querySelector("#auth-form");
  if (form)
    form.onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      const fn = hash.startsWith("#/login")
        ? login(fd.get("email"), fd.get("password"))
        : register(fd.get("email"), fd.get("password"), fd.get("nickname"));
      const r = await fn;
      if (r.status === 200 || r.status === 201) {
        if (migrateGuestDraft()) {
          /* P4 会真正上传游客草稿 */
        }
        location.hash = "#/";
      } else {
        document.querySelector("#auth-err").textContent =
          { bad_email: "邮箱格式不对", weak_password: "密码至少 6 位", email_taken: "这邮箱注册过啦", bad_credentials: "邮箱或密码不对", too_many_requests: "试得太频繁，歇会儿再来" }[r.data?.error] || "出错了，重试一下";
      }
    };
}
