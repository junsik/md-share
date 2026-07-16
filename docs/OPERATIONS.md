# md-share 운영

이 문서는 md-share v1.0 설치, 업그레이드, 백업·복구와 보안 운영 계약을 설명한다.
API 계약은 [API 문서](API.md)를 따른다.

## 설치

운영 이미지는 변경되지 않는 버전 태그나 digest로 고정한다. `/data`에는 영속 volume을
연결하고 업로드 token은 배포 환경의 secret으로 주입한다.

```bash
docker run -d --name md-share \
  -p 3000:3000 \
  -v md-share-data:/data \
  -e MD_SHARE_UPLOAD_TOKEN="$MD_SHARE_UPLOAD_TOKEN" \
  -e MD_SHARE_PUBLIC_BASE_URL="https://md-share.example.com" \
  ghcr.io/junsik/md-share:1.0.0
```

TLS 종료 proxy는 공개 host와 protocol을 전달해야 한다. 전달할 수 없으면
`MD_SHARE_PUBLIC_BASE_URL`을 설정한다. 업로드 요청 제한은 애플리케이션의 2 MiB 제한보다
작지 않게 둔다.

## 업그레이드

1. 사용할 이미지 태그와 digest를 확인해 배포 정의에 고정한다.
2. 아래 절차로 데이터 전체를 백업한다.
3. 새 이미지를 시작하고 `GET /openapi.yaml`과 인증된 `GET /api/status`를 확인한다.
4. 임시 Markdown 문서를 업로드하고 렌더링 URL과 원문 URL을 확인한 뒤 관리 token으로
   삭제한다.
5. 문제가 있으면 프로세스를 중지하고 직전 이미지와 백업한 데이터 전체를 함께 복원한다.

여러 md-share 프로세스가 하나의 로컬 filesystem volume을 동시에 쓰는 구성은 지원하지
않는다.

## 백업과 복구

`MD_SHARE_DATA_DIR` 전체가 하나의 백업 단위다. Docker 이미지에서는 `/data`다. 이
디렉터리에는 Markdown 본문, 문서 메타데이터와 `.idempotency` 재시도 기록이 함께 있다.
일부 파일만 복사하면 문서와 재시도 결과가 달라질 수 있다.

일관된 백업은 다음 중 하나로 만든다.

- md-share 프로세스를 중지한 뒤 데이터 디렉터리 전체를 복사한다.
- volume이 제공하는 원자적 filesystem snapshot을 사용한다.

복구할 때는 프로세스를 중지하고 빈 데이터 디렉터리에 백업 전체를 복원한 뒤, 서비스
사용자가 읽고 쓸 수 있는 권한을 적용한다. 서비스를 시작한 후 인증된 `/api/status`와
표본 문서의 렌더링·원문 URL을 확인한다. 같은 `Idempotency-Key` 재시도는 백업에 포함된
`.idempotency` 기록을 기준으로 동작한다.

## 보안 운영

- `MD_SHARE_UPLOAD_TOKEN`은 secret store로 관리하고 로그, 이미지와 저장소에 넣지 않는다.
- 공개 인터넷에서 `MD_SHARE_ALLOW_ANONYMOUS_UPLOADS=true`를 사용하지 않는다.
- 공개 링크는 bearer credential이다. 링크를 아는 사용자는 렌더링 문서와 원문을 읽을 수
  있으므로 민감정보를 업로드하지 않는다.
- `manageToken`은 생성 응답에서 한 번만 제공된다. 삭제나 만료 변경이 필요하면 안전한
  개인 저장소에 보관하고 메시지나 로그에 남기지 않는다.
- data volume에는 Markdown 평문과 token hash가 저장된다. volume 접근 권한과 백업
  접근 권한을 서비스 운영자에게만 부여한다.
- proxy와 애플리케이션 로그에는 요청 본문, Authorization, 관리 token과 query string을
  기록하지 않는다.

## 상태 확인

`GET /api/status`는 업로드 bearer token을 요구하며 문서 본문 없이 저장 문서 수, byte 수,
만료 문서 수를 반환한다. 정상 상태 확인은 다음과 같이 수행한다.

```bash
curl -fsS \
  -H "Authorization: Bearer $MD_SHARE_UPLOAD_TOKEN" \
  "https://md-share.example.com/api/status"
```

업로드가 `503 UPLOAD_AUTH_FAILED`를 반환하면 운영 token 설정을 확인한다. 저장 오류가
반복되면 volume의 쓰기 권한과 여유 공간을 확인한 뒤 데이터 디렉터리 전체를 보존한
상태에서 진단한다.
