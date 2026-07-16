const tabLogin = document.getElementById("tab-login");
const tabReg = document.getElementById("tab-register");
const formLogin = document.getElementById("form-login");
const formReg = document.getElementById("form-register");
const msg = document.getElementById("msg");
const authContext = document.getElementById("auth-context");

function setMsg(text, type) {
  msg.textContent = text;
  msg.className = `msg ${type || ""}`.trim();
}

function apiError(data, fallback) {
  return data?.error?.message || fallback;
}

function activateLoginTab() {
  tabLogin.classList.add("active");
  tabReg.classList.remove("active");
  formLogin.classList.remove("hidden");
  formReg.classList.add("hidden");
  setMsg("");
}

function activateRegisterTab() {
  tabReg.classList.add("active");
  tabLogin.classList.remove("active");
  formReg.classList.remove("hidden");
  formLogin.classList.add("hidden");
  setMsg("");
}

tabLogin.addEventListener("click", activateLoginTab);
tabReg.addEventListener("click", activateRegisterTab);

(async () => {
  try {
    const [sessionResponse, statusResponse] = await Promise.all([
      fetch("/api/auth/me", { headers: { Accept: "application/json" } }),
      fetch("/api/auth/status", { headers: { Accept: "application/json" } })
    ]);

    if (sessionResponse.ok) {
      window.location.replace("/app");
      return;
    }

    const status = statusResponse.ok ? await statusResponse.json() : null;
    authContext.textContent = status?.bootstrapRequired
      ? "Crie a primeira conta administrativa neste computador para concluir a configuração segura."
      : "Entre com as credenciais da sua conta Kairo.";

    if (status?.bootstrapRequired) activateRegisterTab();
  } catch {
    authContext.textContent = "Não foi possível consultar o servidor. Verifique se o Kairo está em execução.";
  }
})();

formLogin.addEventListener("submit", async (event) => {
  event.preventDefault();
  const btn = document.getElementById("btn-login");
  btn.disabled = true;
  setMsg("Entrando…");

  try {
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        email: document.getElementById("login-email").value,
        password: document.getElementById("login-password").value
      })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(apiError(data, "Falha ao entrar."));
    setMsg("Bem-vindo!", "ok");
    window.location.replace("/app");
  } catch (error) {
    setMsg(error.message, "erro");
    btn.disabled = false;
  }
});

formReg.addEventListener("submit", async (event) => {
  event.preventDefault();
  const btn = document.getElementById("btn-register");
  btn.disabled = true;
  setMsg("Criando conta…");

  try {
    const res = await fetch("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        name: document.getElementById("reg-name").value,
        email: document.getElementById("reg-email").value,
        password: document.getElementById("reg-password").value
      })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(apiError(data, "Falha ao criar conta."));
    setMsg("Conta criada! Entrando…", "ok");
    window.location.replace("/app");
  } catch (error) {
    setMsg(error.message, "erro");
    btn.disabled = false;
  }
});
