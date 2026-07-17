const paragraphs = Array.from(
  { length: 7 },
  (_, index) =>
    `Review note ${index + 1}: the service remained stable while the team verified capacity, latency, and recovery signals across the reporting period.`
).join("\n\n");

const scenario = {
  id: "reading-navigation",
  title: "긴 문서에서 현재 위치 확인",
  description:
    "긴 공유 문서는 오른쪽 목차에서 현재 section을 강조하고 화면 상단의 얇은 막대로 본문 읽기 진행률을 보여준다.",
  guide: [
    "H2와 H3가 세 개 이상인 긴 Markdown 문서를 공유한다.",
    "오른쪽 On this page 목차에서 문서 구조를 확인한다.",
    "문서를 스크롤하고 현재 section 강조가 본문 위치를 따라가는지 확인한다.",
    "화면 상단의 읽기 진행률이 Markdown 본문을 기준으로 증가하는지 확인한다."
  ],
  screenshot: "docs/assets/ui/reading-navigation.png",
  async run({ page, baseUrl, capture }) {
    const response = await page.request.post(new URL("api/documents", baseUrl).href, {
      headers: { "idempotency-key": "ui-guide-reading-navigation" },
      data: {
        markdown: `# Quarterly service review

## Summary

${paragraphs}

### Key signals

${paragraphs}

## Findings

${paragraphs}

## Next steps

${paragraphs}`,
        title: "Quarterly service review",
        filename: "quarterly-reading-review.md",
        ttlDays: 30
      }
    });
    if (response.status() !== 201) {
      throw new Error(`Reading navigation guide seed returned ${response.status()}`);
    }
    const created = await response.json();

    try {
      await page.goto(new URL(`d/${created.id}`, baseUrl).href, { waitUntil: "networkidle" });
      const toc = page.locator("[data-document-toc]");
      await toc.waitFor();
      if ((await toc.locator("nav.hidden a[data-heading-id]").count()) !== 4) {
        throw new Error("Desktop table of contents is incomplete");
      }

      await page.locator("#heading-findings").evaluate((element) => {
        const top = element.getBoundingClientRect().top + window.scrollY - 96;
        window.scrollTo({ top, behavior: "instant" });
      });
      await page.waitForFunction(
        () =>
          document
            .querySelector('[data-document-toc] nav.hidden [data-heading-id="heading-findings"]')
            ?.getAttribute("aria-current") === "location"
      );
      const progress = Number(
        await page.locator("[data-reading-progress]").getAttribute("aria-valuenow")
      );
      if (!(progress > 0 && progress < 100)) {
        throw new Error(`Reading progress is outside the expected range: ${progress}`);
      }
      await capture();

      await page.setViewportSize({ width: 1100, height: 900 });
      const articleWidth = await page.locator("main").evaluate((element) =>
        element.getBoundingClientRect().width
      );
      if (articleWidth > 1024) {
        throw new Error(`Tablet article exceeded the readable width: ${articleWidth}`);
      }
      if (!(await page.locator("[data-document-toc] details").isVisible())) {
        throw new Error("Tablet table of contents did not switch to the collapsible layout");
      }
    } finally {
      await page.request.delete(new URL(`api/documents/${created.id}`, baseUrl).href, {
        headers: { authorization: `Bearer ${created.manageToken}` }
      });
    }
  }
};

export default scenario;
