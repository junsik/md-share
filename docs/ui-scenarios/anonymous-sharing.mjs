async function unique(locator, label) {
  const count = await locator.count();
  if (count !== 1) throw new Error(`${label} expected one element, found ${count}`);
  return locator;
}

const scenario = {
  id: "anonymous-sharing",
  title: "업로드 token 없이 공유",
  description:
    "익명 공유가 설정된 웹 편집기는 자동화 token을 사용자에게 요구하지 않고 문서별 관리 권한만 브라우저에 저장한다.",
  guide: [
    "편집기에서 Markdown을 작성하고 Share를 누른다.",
    "익명 공유 안내를 확인한다. Upload token 입력란은 표시되지 않는다.",
    "제목과 만료 기간을 선택하고 Create link를 누른다.",
    "생성된 공유 URL만 전달하고 문서 관리 권한은 현재 브라우저에 둔다."
  ],
  screenshot: "docs/assets/ui/anonymous-sharing.png",
  async run({ page, baseUrl, capture }) {
    await page.goto(baseUrl, { waitUntil: "networkidle" });
    await (
      await unique(page.getByPlaceholder("# Start writing markdown..."), "Markdown editor")
    ).fill("# Anonymous sharing\n\nNo operator credential is entered by the viewer.\n");
    await (await unique(page.getByRole("button", { name: "Share", exact: true }), "Share button")).click();
    await page.getByRole("dialog", { name: "Share document", exact: true }).waitFor();
    if ((await page.getByLabel("Upload token", { exact: true }).count()) !== 0) {
      throw new Error("Anonymous share dialog exposes the automation token input");
    }
    await page
      .getByText("Anonymous sharing is enabled. No upload token is required.", { exact: true })
      .waitFor();
    const titleInput = await unique(
      page.getByRole("textbox", { name: "Title (optional)", exact: true }),
      "Title input"
    );
    await titleInput.fill("Anonymous sharing");
    await titleInput.evaluate((element) => element.blur());
    await capture();
    await (await unique(page.getByRole("button", { name: "Cancel", exact: true }), "Cancel button")).click();
  }
};

export default scenario;
