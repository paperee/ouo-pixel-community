// 全站统一样式弹窗（替代浏览器默认 confirm/alert/prompt），挂 body 全局可用。
let els = null;

function ensure() {
  if (els) return els;
  const wrap = document.createElement("div");
  wrap.innerHTML = `
    <div class="modal-backdrop dlg-backdrop" data-dlg hidden>
      <div class="px-card modal dlg">
        <h2 class="px-title" data-dlg-title>请确认</h2>
        <p data-dlg-msg></p>
        <input class="px-input" data-dlg-input hidden>
        <div class="row" style="align-items:center">
          <button class="px-btn px-btn--cherry" data-dlg-ok title="Enter/空格">确定</button>
          <button class="px-btn" data-dlg-cancel title="Esc">取消</button>
          <span class="hint" data-dlg-keys></span>
        </div>
        <div class="stack" data-dlg-choices hidden></div>
      </div>
    </div>`;
  document.body.appendChild(wrap);
  wrap.querySelector("[data-dlg]").addEventListener("pointerdown", (e) => {
    if (!e.target.hasAttribute("data-dlg")) return;
    if (els._useChoices) els._done?.(null);
    else els.cancel.onclick?.();
  });
  els = {
    back: wrap.querySelector("[data-dlg]"),
    title: wrap.querySelector("[data-dlg-title]"),
    msg: wrap.querySelector("[data-dlg-msg]"),
    input: wrap.querySelector("[data-dlg-input]"),
    ok: wrap.querySelector("[data-dlg-ok]"),
    cancel: wrap.querySelector("[data-dlg-cancel]"),
    keys: wrap.querySelector("[data-dlg-keys]"),
    choices: wrap.querySelector("[data-dlg-choices]"),
  };
  // 快捷键：Enter 确定（含输入框内回车，输入法组字中不触发），Esc 取消；
  // 空格同确认，但输入框里敲空格是打字，不触发；
  // 纯提示框没有取消键，Esc 同样关闭；三选一框 Enter 走首选项，Esc 算取消
  const isTypingEl = (t) => t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);
  document.addEventListener("keydown", (e) => {
    if (!els || els.back.hidden || !els._done) return;
    if (e.key === "Escape") {
      e.preventDefault();
      if (els._useChoices) els._done(null);
      else (els.cancel.style.display === "none" ? els.ok : els.cancel).click();
    } else if (e.key === "Enter" && !e.isComposing && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      if (els._useChoices) els.choices.querySelector("[data-dlg-pick]")?.click();
      else els.ok.click();
    } else if (e.key === " " && !e.isComposing && !e.ctrlKey && !e.metaKey && !isTypingEl(e.target)) {
      // 空格等同确认：keydown 里 preventDefault 掉，顺带拦住按钮原生的空格激活，避免点两次；
      // 输入框里敲空格是打字，不能确认
      e.preventDefault();
      if (els._useChoices) els.choices.querySelector("[data-dlg-pick]")?.click();
      else els.ok.click();
    }
  });
  return els;
}

export function uiDialog({ title = "请确认", msg = "", input = null, okText = "确定", choices = null } = {}) {
  const d = ensure();
  return new Promise((resolve) => {
    d.title.textContent = title;
    d.msg.textContent = msg;
    d.ok.textContent = okText;
    const useChoices = Array.isArray(choices) && choices.length > 0;
    const useInput = !useChoices && input !== null && input !== undefined;
    d.input.hidden = !useInput;
    d.ok.style.display = useChoices ? "none" : "";
    d.cancel.style.display = useChoices ? "none" : useInput || okText !== "知道了" ? "" : "none";
    d.choices.hidden = !useChoices;
    d.choices.innerHTML = useChoices
      ? choices.map((c, i) => `<button class="px-btn${c.primary ? " px-btn--cherry" : ""}" data-dlg-pick="${i}">${c.label}</button>`).join("")
      : "";
    d.keys.textContent = useChoices ? "Enter/空格 首选 · Esc 取消" : d.cancel.style.display === "none" ? "Enter/空格 关闭" : "Enter/空格 确定 · Esc 取消";
    const done = (v) => {
      d.back.hidden = true;
      d.ok.onclick = d.cancel.onclick = null;
      d.choices.onclick = null;
      d._done = null;
      resolve(v);
    };
    d._done = done;
    d._useChoices = useChoices;
    if (useChoices) {
      d.choices.onclick = (e) => {
        const b = e.target.closest("[data-dlg-pick]");
        if (!b) return;
        done(choices[Number(b.dataset.dlgPick)].value);
      };
    } else if (useInput) {
      d.input.value = input;
      setTimeout(() => d.input.focus(), 0);
    } else {
      setTimeout(() => d.ok.focus(), 0);
    }
    d.back.hidden = false;
    // 弹窗是模态的：顺手收起所有自绘下拉弹层，避免选项浮在变暗的页面上
    document.querySelectorAll(".ps-list").forEach((l) => { l.hidden = true; });
    d.ok.onclick = () => done(useInput ? d.input.value : true);
    d.cancel.onclick = () => done(useInput ? null : false);
  });
}

export const uiAlert = (msg) => uiDialog({ title: "提示", msg, okText: "知道了" });
export const uiConfirm = (msg, okText = "确定") => uiDialog({ title: "请确认", msg, okText });
export const uiPrompt = (msg, def = "") => uiDialog({ title: "输入", msg, input: def });
// 三选一（备份位满时用）：resolve 选中项的 value，Esc/点遮罩算 null
export const uiChoice = ({ title = "请选择", msg = "", choices = [] } = {}) =>
  uiDialog({ title, msg, choices });
