async function unique(locator, label) {
  const count = await locator.count();
  if (count !== 1) throw new Error(`${label} expected one element, found ${count}`);
  return locator;
}

const scenario = {
  id: "owned-documents",
  title: "이 브라우저에서 만든 문서 관리",
  description:
    "웹에서 만든 공유 문서의 관리 권한은 공유 링크와 분리되어 현재 브라우저 프로필에만 저장된다.",
  guide: [
    "편집기에서 Markdown을 작성하고 Share를 눌러 링크를 만든다.",
    "공유 결과에서 관리 권한이 이 브라우저에 저장됐는지 확인한다.",
    "Open My documents를 눌러 이 브라우저가 관리할 수 있는 문서를 연다.",
    "만료 기간을 변경하거나 Keep forever를 선택해 보관 기간을 갱신한다.",
    "Forget access는 로컬 권한만 지우고, Delete document는 모든 접속자에게서 문서를 삭제한다."
  ],
  screenshot: "docs/assets/ui/owned-documents.png",
  async run({ page, browser, baseUrl, capture }) {
    await page.goto(baseUrl, { waitUntil: "networkidle" });
    await (
      await unique(page.getByPlaceholder("# Start writing markdown..."), "Markdown editor")
    ).fill("# Browser-owned report\n\nThis document demonstrates local management access.\n");
    await (await unique(page.getByRole("button", { name: "Share", exact: true }), "Share button")).click();
    if ((await page.getByLabel("Upload token", { exact: true }).count()) !== 0) {
      throw new Error("Anonymous share dialog exposes the automation token input");
    }
    await (
      await unique(page.getByRole("textbox", { name: "Title (optional)", exact: true }), "Title input")
    ).fill("Browser-owned report");
    await (
      await unique(page.getByRole("button", { name: "Create link", exact: true }), "Create link button")
    ).click();
    await page
      .getByText(
        "Management access is saved only in this browser. It is not part of the shared link.",
        { exact: true }
      )
      .waitFor({ state: "visible" });
    await (
      await unique(
        page.getByRole("button", { name: "Open My documents", exact: true }),
        "Open My documents button"
      )
    ).click();
    await page.getByRole("dialog", { name: "My documents", exact: true }).waitFor({ state: "visible" });
    await page.getByRole("button", { name: "Refresh", exact: true }).waitFor({ state: "visible" });

    const openLink = await unique(page.getByRole("link", { name: "Open", exact: true }), "Open link");
    const publicUrl = await openLink.getAttribute("href");
    if (!publicUrl) throw new Error("Open link has no href");
    const parsedPublicUrl = new URL(publicUrl, baseUrl);
    if (parsedPublicUrl.search || parsedPublicUrl.hash) {
      throw new Error("Public document URL contains unexpected capability data");
    }
    const viewerContext = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      colorScheme: "dark",
      reducedMotion: "reduce"
    });
    const viewerPage = await viewerContext.newPage();
    await viewerPage.goto(publicUrl, { waitUntil: "networkidle" });
    for (const label of ["My documents", "Update expiry", "Delete document"]) {
      if ((await viewerPage.getByText(label, { exact: true }).count()) !== 0) {
        throw new Error(`Public document page exposes management UI: ${label}`);
      }
    }
    await viewerContext.close();

    const expiry = await unique(
      page.getByRole("combobox", { name: "Expiry for Browser-owned report", exact: true }),
      "Expiry selector"
    );
    await expiry.selectOption({ value: "forever" });
    await (
      await unique(
        page.getByRole("button", { name: "Update expiry", exact: true }),
        "Update expiry button"
      )
    ).click();
    await page
      .getByText("Expiry updated for “Browser-owned report”.", { exact: true })
      .waitFor({ state: "visible" });
    await page
      .getByText(/^Markdown document · \d+ B · Kept forever$/)
      .waitFor({ state: "visible" });
    await capture();

    await (
      await unique(
        page.getByRole("button", { name: "Delete document", exact: true }),
        "Delete document button"
      )
    ).click();
    await (
      await unique(
        page.getByRole("button", { name: "Delete permanently", exact: true }),
        "Delete permanently button"
      )
    ).click();
    await page.getByText("No documents saved in this browser", { exact: true }).waitFor({
      state: "visible"
    });
  }
};

export default scenario;
