# md-share HTTP API

md-share의 모든 문서 작업은 이 HTTP API를 사용한다. 요청과 응답은 UTF-8이며 문서 본문은
최대 2 MiB다. 기계 판독 가능한 계약은
[`/openapi.yaml`](https://md-share.example.com/openapi.yaml)에서 제공한다.

## 인증

md-share는 문서 생성, 문서별 관리와 운영자 작업을 서로 다른 권한으로 구분한다.

| 권한 | 서버 설정 또는 발급 시점 | 허용 작업 |
| --- | --- | --- |
| 익명 생성 | `MD_SHARE_ALLOW_ANONYMOUS_UPLOADS=true` | 인증 없는 `POST /api/documents` |
| 운영자 token | `MD_SHARE_UPLOAD_TOKEN=<TOKEN>` | 최근 목록, 상태, 임의 문서 삭제, 인증된 업로드 |
| 문서 관리 token | 문서 생성 응답 | 해당 문서의 만료 변경과 삭제 |
| 개발 | operator token이 없고 `NODE_ENV != production` | 생성, 최근 목록과 상태 |

운영자 요청은 `Authorization: Bearer <OPERATOR_TOKEN>`을 사용한다. 익명 생성이 켜져 있어도
최근 문서 목록과 상태는 운영자 token을 요구한다. 렌더링 페이지, 공개 메타데이터와 원문은
링크를 아는 사용자가 인증 없이 조회할 수 있다.

문서 생성 응답은 문서별 `manageToken`을 한 번만 반환한다. 이 값은 서버에 평문으로
저장되지 않으며, 만료 변경과 삭제 요청에서 Bearer token으로 사용한다.

## 문서 생성

### `POST /api/documents`

JSON 요청:

```bash
curl -X POST https://md-share.example.com/api/documents \
  -H "Content-Type: application/json; charset=utf-8" \
  -H "Idempotency-Key: <STABLE_REQUEST_KEY>" \
  --data-binary @payload.json
```

```json
{
  "markdown": "# Report title\n\n본문",
  "title": "선택 제목",
  "filename": "report.md",
  "ttlDays": 30
}
```

raw Markdown 요청:

```bash
curl -X POST \
  "https://md-share.example.com/api/documents?filename=report.md&ttlDays=7" \
  -H "Content-Type: text/markdown; charset=utf-8" \
  -H "Idempotency-Key: <STABLE_REQUEST_KEY>" \
  --data-binary @report.md
```

| 입력 | 형식 | 설명 |
| --- | --- | --- |
| `markdown` | string, 필수 | 비어 있지 않은 UTF-8 Markdown. NUL 문자는 허용하지 않는다. |
| `title` | string, 선택 | 최대 200자. 없으면 첫 heading을 사용한다. |
| `filename` | string, 선택 | 최대 255자의 파일명. 전달하면 `.md`만 허용하며 경로는 거절한다. |
| `ttlDays` | 양수 또는 `null`, 선택 | 양수는 생성 시각 기준 만료 일수, `null`은 무기한, 생략은 서버 기본값이다. |
| `Idempotency-Key` | header, 선택 | 최대 200자. 네트워크 실패 뒤 같은 요청을 안전하게 재시도할 때 사용한다. |

최초 생성은 `201`을 반환한다.

```json
{
  "id": "ndremUMOcwQp",
  "title": "Report title",
  "originalFilename": "report.md",
  "createdAt": "2026-07-16T10:00:00.000Z",
  "expiresAt": "2026-07-23T10:00:00.000Z",
  "size": 28,
  "url": "https://md-share.example.com/d/ndremUMOcwQp",
  "rawUrl": "https://md-share.example.com/api/documents/ndremUMOcwQp/raw",
  "replayed": false,
  "manageToken": "<ONE_TIME_MANAGEMENT_TOKEN>"
}
```

같은 key와 같은 요청의 재시도는 같은 문서를 `200`으로 반환한다. 이 응답은
`replayed: true`이며 `manageToken`을 다시 포함하지 않는다. 같은 key에 다른 요청을 보내면
`409 IDEMPOTENCY_CONFLICT`를 반환한다. 연결이 끊겨 응답을 받지 못했으면 key를 바꾸지 않고
재시도해야 한다.

익명 생성은 기본적으로 client별 20회/분, process 전체 200회/분으로 제한한다. 초과하면
`429 ANONYMOUS_UPLOAD_RATE_LIMITED`와 `Retry-After`, `X-RateLimit-*` header를 반환한다.
`X-RateLimit-Scope`는 소진된 한도가 `client`인지 `global`인지 나타낸다.
운영자 token을 포함한 업로드는 이 제한을 적용하지 않는다. 제한값과 시간창은 운영 환경
변수로 설정한다.

## 문서 조회

### `GET /api/documents/{id}`

인증 없이 본문을 제외한 공개 메타데이터, `url`, `rawUrl`을 반환한다. 없는 문서와 만료된
문서는 `404`다.

### `GET /api/documents/{id}/raw`

인증 없이 원문을 `text/markdown; charset=utf-8`로 반환한다. 생성 시 파일명이 전달되었으면
`Content-Disposition`에 UTF-8 파일명으로 포함한다.

### `GET /d/{id}`

사용자에게 전달할 렌더링 페이지다. 제목과 Open Graph 메타데이터를 제공한다.

### `GET /api/documents`

운영자 token이 필요하다. 만료되지 않은 최근 문서 최대 50건을 최신순으로 반환한다.
응답은 본문과 관리 token을 포함하지 않는다.

## 문서 관리

문서 관리 요청의 `Authorization`에는 생성 시 한 번 받은 문서별 `manageToken`을 사용한다.

### `PATCH /api/documents/{id}`

만료 시각을 현재 시각 기준으로 다시 설정한다.

```bash
curl -X PATCH https://md-share.example.com/api/documents/{id} \
  -H "Authorization: Bearer <ONE_TIME_MANAGEMENT_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"ttlDays": 7}'
```

`{"ttlDays": null}`은 무기한 보관으로 설정한다. 성공 시 갱신된 공개 메타데이터를
반환한다.

### `DELETE /api/documents/{id}`

```bash
curl -X DELETE https://md-share.example.com/api/documents/{id} \
  -H "Authorization: Bearer <ONE_TIME_MANAGEMENT_TOKEN>"
```

성공하면 `204`다. 이후 렌더링, 메타데이터와 원문 URL은 모두 `404`를 반환한다.
운영자는 같은 endpoint에 운영자 token을 보내 관리 token을 잃은 문서도 삭제할 수 있다.
운영자 token은 `PATCH` 권한을 부여하지 않는다.

```bash
curl -X DELETE https://md-share.example.com/api/documents/{id} \
  -H "Authorization: Bearer <OPERATOR_TOKEN>"
```

### 브라우저 `My documents`

익명 생성이 설정된 웹 편집기는 upload token 입력란을 표시하지 않는다. 새 링크를 만들면
브라우저는 공개 메타데이터와 문서별 `manageToken`을 현재
origin의 local storage에 저장한다. Markdown 본문과 운영자 bearer token은 저장하지
않는다. `My documents`는 이 브라우저에 저장된 문서만 표시하며 공개 메타데이터 새로 고침,
만료 변경, 영구 삭제와 로컬 관리 권한 제거를 제공한다.

이 기능은 사용자 계정이나 관리자 목록이 아니다. 공유 URL에는 `manageToken`이 들어가지
않으며 `/d/{id}` 접속자는 관리 UI나 관리 권한을 받지 않는다. 다른 브라우저 프로필에서는
같은 목록을 볼 수 없고, 브라우저 데이터를 지우거나 `Forget access`를 실행하면 서버에서
권한을 복구할 수 없다. local storage를 읽을 수 있는 같은 origin의 JavaScript도 관리
token에 접근할 수 있으므로 운영자는 같은 origin에 신뢰하지 않는 코드를 제공하지 않는다.

## 운영 상태

### `GET /api/status`

운영자 token이 필요하다. 본문 없이 활성 문서 수, 저장 bytes와 만료가 설정된 문서 수를
반환한다.

```json
{
  "status": "ok",
  "storage": { "documents": 12, "bytes": 48231, "expiringDocuments": 10 }
}
```

## 에이전트용 문서

| 경로 | 설명 |
| --- | --- |
| `GET /skill.md` | 실행 중인 인스턴스 URL이 반영된 agent skill |
| `GET /api.md` | 실행 중인 인스턴스 URL이 반영된 이 API 문서 |
| `GET /openapi.yaml` | OpenAPI 3.1 계약 |
| `GET /llms.txt` | 문서 탐색 index |

## 오류 형식

JSON 오류는 안정적인 `code`와 사람이 읽을 `message`를 함께 반환한다.

```json
{ "error": { "code": "UNSUPPORTED_FILE_TYPE", "message": "only .md files are supported" } }
```

| 상태 | 주요 code | 의미 |
| --- | --- | --- |
| `400` | `INVALID_JSON`, `INVALID_UTF8`, `EMPTY_MARKDOWN`, `BINARY_MARKDOWN`, `INVALID_FILENAME`, `UNSUPPORTED_FILE_TYPE`, `INVALID_TTL`, `INVALID_IDEMPOTENCY_KEY` | 요청 검증 실패 |
| `401` | `UPLOAD_AUTH_FAILED`, `OPERATOR_AUTH_FAILED`, `MANAGE_AUTH_REQUIRED` | 필요한 token이 없거나 맞지 않음 |
| `403` | `MANAGE_AUTH_FAILED` | 문서 관리 token이 맞지 않음 |
| `404` | `DOCUMENT_NOT_FOUND` | 문서가 없거나 만료됨 |
| `409` | `IDEMPOTENCY_CONFLICT` | 같은 key를 다른 요청에 사용함 |
| `410` | `IDEMPOTENCY_GONE` | key가 가리키는 문서가 삭제 또는 만료됨 |
| `413` | `REQUEST_TOO_LARGE`, `DOCUMENT_TOO_LARGE` | 요청 또는 Markdown이 허용 크기를 초과함 |
| `415` | `UNSUPPORTED_MEDIA_TYPE` | multipart 요청을 사용함 |
| `429` | `ANONYMOUS_UPLOAD_RATE_LIMITED` | 익명 client 또는 process 전체 요청 제한 초과 |
| `503` | `IDEMPOTENCY_BUSY`, `STORAGE_UNAVAILABLE`, `UPLOAD_AUTH_FAILED`, `OPERATOR_AUTH_FAILED` | 저장소·재시도 상태 또는 운영자 설정 오류 |

`429`와 재시도 가능한 `503` 응답은 `Retry-After`를 포함한다.

## 저장과 만료

- 본문을 먼저 원자적으로 게시하고 메타데이터를 마지막에 게시하므로, 조회자는 완성된 문서만
  볼 수 있다.
- 프로세스 중단으로 남은 임시 파일과 고아 본문은 background sweep이 정리한다.
- 만료된 문서는 첫 조회와 background sweep에서 삭제한다.
- idempotency 기록은 문서 ID를 먼저 예약하므로 저장 중 중단되어도 같은 key의 재시도가 같은
  문서 ID를 완성한다.

## 렌더링 계약

- GFM 표, task list, 취소선과 syntax-highlighted fenced code block을 렌더링한다.
- `mermaid` fenced code block은 브라우저에서 다이어그램으로 렌더링한다.
- raw HTML은 렌더링하지 않는다. GFM 표 셀 줄바꿈에 필요한 `<br>`만 허용한다.
- `data:image/png|jpeg|gif|webp;base64,...` 이미지는 허용하고 다른 `data:` URI는 차단한다.

한글 같은 비ASCII 본문은 셸 인자에 넣지 말고 UTF-8 파일을 `--data-binary @file`로 전송한다.
