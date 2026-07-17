const paragraphs = Array.from(
  { length: 5 },
  (_, index) =>
    `Mobile review note ${index + 1}: the section keeps enough content to verify document-relative scrolling and navigation.`
).join("\n\n");

const scenario = {
  id: "reading-navigation-mobile",
  title: "모바일에서 목차 펼치기",
  description:
    "작은 화면에서는 오른쪽 sidebar 대신 접을 수 있는 On this page 목차를 본문 위에 표시한다.",
  guide: [
    "모바일 화면에서 긴 공유 문서를 연다.",
    "본문 위의 On this page를 눌러 목차를 펼친다.",
    "목차에서 section을 선택하면 해당 heading으로 이동하고 목차가 닫히는지 확인한다.",
    "모바일에서도 본문 기준 읽기 진행률이 유지되는지 확인한다."
  ],
  screenshot: "docs/assets/ui/reading-navigation-mobile.png",
  viewport: { width: 390, height: 844 },
  async run({ page, baseUrl, capture }) {
    const response = await page.request.post(new URL("api/documents", baseUrl).href, {
      headers: { "idempotency-key": "ui-guide-reading-navigation-mobile" },
      data: {
        markdown: `# Mobile service review

## Summary

${paragraphs}

### Key signals

${paragraphs}

## Findings

${paragraphs}

## Next steps

${paragraphs}`,
        title: "Mobile service review",
        filename: "mobile-reading-review.md",
        ttlDays: 30
      }
    });
    if (response.status() !== 201) {
      throw new Error(`Mobile reading guide seed returned ${response.status()}`);
    }
    const created = await response.json();

    try {
      await page.goto(new URL(`d/${created.id}`, baseUrl).href, { waitUntil: "networkidle" });
      await page.locator("[data-document-timestamps]").evaluate((element) => {
        element.textContent = "Created 2026-07-17 05:00 UTC · expires 2026-08-16 05:00 UTC";
      });
      const details = page.locator("[data-document-toc] details");
      await details.getByText("On this page", { exact: false }).click();
      if (!(await details.evaluate((element) => element.hasAttribute("open")))) {
        throw new Error("Mobile table of contents did not open");
      }
      await capture();

      await details.locator('[data-heading-id="heading-findings"]').click();
      await page.waitForFunction(
        () => window.location.hash === "#heading-findings" && !document.querySelector("details[open]")
      );
      await page.waitForFunction(
        () => Number(document.querySelector("[data-reading-progress]")?.getAttribute("aria-valuenow")) > 0
      );
    } finally {
      await page.request.delete(new URL(`api/documents/${created.id}`, baseUrl).href, {
        headers: { authorization: `Bearer ${created.manageToken}` }
      });
    }
  }
};

export default scenario;
