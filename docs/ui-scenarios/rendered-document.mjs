async function unique(locator, label) {
  const count = await locator.count();
  if (count !== 1) throw new Error(`${label} expected one element, found ${count}`);
  return locator;
}

const scenario = {
  id: "rendered-document",
  title: "공유 문서 제목을 한 번만 표시",
  description:
    "Markdown이 H1 제목으로 시작하면 공유 페이지는 본문 제목을 사용하고 상단 도구 영역에서 같은 제목을 반복하지 않는다.",
  guide: [
    "H1 제목으로 시작하는 Markdown 문서를 공유한다.",
    "공유 페이지 상단에서 생성·만료 정보와 문서 도구를 확인한다.",
    "문서 제목이 본문 카드 안에 한 번만 표시되는지 확인한다.",
    "짧은 문서에서는 목차와 읽기 진행률이 표시되지 않는지 확인한다.",
    "Raw .md로 원문을 열거나 Share new로 새 문서를 작성한다."
  ],
  screenshot: "docs/assets/ui/rendered-document.png",
  async run({ page, baseUrl, capture }) {
    const response = await page.request.post(new URL("api/documents", baseUrl).href, {
      headers: { "idempotency-key": "ui-guide-rendered-document" },
      data: {
        markdown:
          "# Quarterly service review\n\n## Summary\n\nThe rendered page keeps one clear document title.",
        title: "Quarterly service review",
        filename: "quarterly-service-review.md",
        ttlDays: 30
      }
    });
    if (response.status() !== 201) {
      throw new Error(`Rendered document guide seed returned ${response.status()}`);
    }
    const created = await response.json();

    try {
      await page.goto(new URL(`d/${created.id}`, baseUrl).href, { waitUntil: "networkidle" });
      await unique(
        page.getByRole("heading", { name: "Quarterly service review", exact: true }),
        "visible document title"
      );
      await page.getByRole("heading", { name: "Summary", exact: true }).waitFor();
      if ((await page.locator("[data-document-toc]").count()) !== 0) {
        throw new Error("Short document unexpectedly rendered a table of contents");
      }
      if ((await page.locator("[data-reading-progress]").count()) !== 0) {
        throw new Error("Short document unexpectedly rendered reading progress");
      }
      await page.locator("[data-document-timestamps]").evaluate((element) => {
        element.textContent = "Created 2026-07-17 05:00 UTC · expires 2026-08-16 05:00 UTC";
      });
      await capture();
    } finally {
      await page.request.delete(new URL(`api/documents/${created.id}`, baseUrl).href, {
        headers: { authorization: `Bearer ${created.manageToken}` }
      });
    }
  }
};

export default scenario;
