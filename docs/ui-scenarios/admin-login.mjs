async function unique(locator, label) {
  const count = await locator.count();
  if (count !== 1) throw new Error(`${label} expected one element, found ${count}`);
  return locator;
}

const scenario = {
  id: "admin-login",
  title: "관리자 ID와 비밀번호로 로그인",
  description:
    "관리자는 설치자가 정한 ID와 비밀번호를 입력해 임시 관리자 세션을 만든다. 비밀번호는 브라우저 저장소에 남지 않는다.",
  guide: [
    "운영 주소의 /admin/login을 연다.",
    "설치 시 설정한 Administrator ID와 Password를 입력한다.",
    "Sign in을 누르면 HttpOnly 관리자 세션으로 운영 콘솔에 진입한다.",
    "작업이 끝나면 Sign out으로 세션을 종료한다."
  ],
  screenshot: "docs/assets/ui/admin-login.png",
  async run({ page, baseUrl, capture }) {
    await page.goto(new URL("admin/login", baseUrl).href, { waitUntil: "networkidle" });
    await page.getByRole("heading", { name: "Administrator sign in", exact: true }).waitFor();
    await unique(page.getByLabel("Administrator ID", { exact: true }), "Administrator ID input");
    await unique(page.getByLabel("Password", { exact: true }), "Password input");
    await capture();
  }
};

export default scenario;
