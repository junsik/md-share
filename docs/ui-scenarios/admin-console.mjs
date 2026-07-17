async function unique(locator, label) {
  const count = await locator.count();
  if (count !== 1) throw new Error(`${label} expected one element, found ${count}`);
  return locator;
}

const scenario = {
  id: "admin-console",
  title: "운영 콘솔에서 전체 문서 관리",
  description:
    "관리자 세션은 전체 문서의 메타데이터와 저장량을 조회하고 선택한 문서를 영구 삭제할 수 있다. Markdown 본문은 콘솔에 표시하지 않는다.",
  guide: [
    "관리자 로그인 후 Operations console을 연다.",
    "활성 문서 수, 저장된 Markdown 크기와 만료 문서 수를 확인한다.",
    "제목, 파일명 또는 문서 ID로 최근 문서를 검색한다.",
    "Open 또는 Raw로 문서를 확인하거나 Delete를 눌러 영구 삭제한다.",
    "관리자 세션은 문서 만료 기간을 변경하지 않는다."
  ],
  screenshot: "docs/assets/ui/admin-console.png",
  async run({ page, baseUrl, capture }) {
    const createResponse = await page.request.post(new URL("api/documents", baseUrl).href, {
      headers: { "idempotency-key": "ui-guide-admin-console" },
      data: {
        markdown: "# Operations sample\n\nThis temporary document is managed without exposing its body.",
        title: "Operations sample",
        ttlDays: 30
      }
    });
    if (createResponse.status() !== 201) {
      throw new Error(`Admin guide seed returned ${createResponse.status()}`);
    }
    const created = await createResponse.json();

    try {
      await page.goto(new URL("admin/login", baseUrl).href, { waitUntil: "networkidle" });
      await (await unique(page.getByLabel("Administrator ID", { exact: true }), "ID input")).fill(
        "guide-operator"
      );
      await (await unique(page.getByLabel("Password", { exact: true }), "Password input")).fill(
        "ui-guide-password"
      );
      await (await unique(page.getByRole("button", { name: "Sign in", exact: true }), "Sign in button")).click();
      await page.waitForURL(/\/admin$/);
      await page.getByRole("heading", { name: "Operations console", exact: true }).waitFor();
      await page.getByText("Signed in as guide-operator", { exact: false }).waitFor();
      await page.getByRole("heading", { name: "Operations sample", exact: true }).waitFor();
      if ((await page.getByText("This temporary document is managed without exposing its body.").count()) !== 0) {
        throw new Error("Operations console exposes Markdown body content");
      }
      await capture();

      await (await unique(page.getByRole("button", { name: "Delete", exact: true }), "Delete button")).click();
      await (
        await unique(
          page.getByRole("button", { name: "Delete permanently", exact: true }),
          "Delete permanently button"
        )
      ).click();
      await page.getByText("No active documents.", { exact: true }).waitFor();
      await (await unique(page.getByRole("button", { name: "Sign out", exact: true }), "Sign out button")).click();
      await page.waitForURL(/\/admin\/login$/);
    } finally {
      await page.request.delete(new URL(`api/documents/${created.id}`, baseUrl).href, {
        headers: { authorization: `Bearer ${created.manageToken}` }
      });
    }
  }
};

export default scenario;
