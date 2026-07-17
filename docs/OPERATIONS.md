# md-share 운영

이 문서는 md-share v1.3 설치, 관리자 인증, 백업·복구와 보안 운영 계약을 설명한다. API
계약은 [API 문서](API.md)를 따른다.

## 설치

운영 이미지는 변경되지 않는 버전 tag나 digest로 고정한다. `/data`에는 영속 volume을
연결한다. 설치자는 instance마다 관리자 ID와 8자 이상의 password를 직접 정해 secret
store에서 다음 환경 변수로 주입한다. image와 배포 manifest에는 기본 credential이 없다.

- `MD_SHARE_ADMIN_USERNAME`
- `MD_SHARE_ADMIN_PASSWORD`

```bash
docker run -d --name md-share \
  -p 3000:3000 \
  -v md-share-data:/data \
  -e MD_SHARE_ADMIN_USERNAME="$MD_SHARE_ADMIN_USERNAME" \
  -e MD_SHARE_ADMIN_PASSWORD="$MD_SHARE_ADMIN_PASSWORD" \
  -e MD_SHARE_ALLOW_ANONYMOUS_UPLOADS="true" \
  -e MD_SHARE_ANONYMOUS_UPLOAD_LIMIT="20" \
  -e MD_SHARE_ANONYMOUS_UPLOAD_GLOBAL_LIMIT="200" \
  -e MD_SHARE_PUBLIC_BASE_URL="https://md-share.example.com" \
  ghcr.io/junsik/md-share:1.3.1
```

TLS 종료 proxy는 공개 host와 protocol을 전달해야 한다. 전달할 수 없으면
`MD_SHARE_PUBLIC_BASE_URL`을 설정한다. upload 요청 제한은 application의 2 MiB 제한보다
작지 않게 둔다.

익명 제한은 process memory의 고정 시간창이다. client 주소는 hash key로만 보관하며 로그에
남기지 않는다. filesystem volume을 공유하는 다중 process 구성은 지원하지 않으므로 지원
구성에서는 하나의 process 전체 제한이 적용된다.

## Kubernetes credential 주입

관리자 ID/password는 설치 환경의 Secret 관리 방식에 따라 만든다. 저장소 밖의 접근 제한된
로컬 파일 또는 external secret provider를 사용하고, credential을 YAML이나 shell history에
직접 적지 않는다. 다음은 로컬 env file을 사용하는 예다.

```dotenv
MD_SHARE_ADMIN_USERNAME=<INSTALLER_SELECTED_ADMIN_ID>
MD_SHARE_ADMIN_PASSWORD=<INSTALLER_SELECTED_ADMIN_PASSWORD>
```

```bash
kubectl -n <NAMESPACE> create secret generic md-share-auth \
  --from-env-file=/secure/local/path/md-share-admin.env
```

Pod specification은 Secret의 key를 환경 변수에 연결한다.

```yaml
env:
  - name: MD_SHARE_ADMIN_USERNAME
    valueFrom:
      secretKeyRef:
        name: md-share-auth
        key: MD_SHARE_ADMIN_USERNAME
  - name: MD_SHARE_ADMIN_PASSWORD
    valueFrom:
      secretKeyRef:
        name: md-share-auth
        key: MD_SHARE_ADMIN_PASSWORD
```

고정된 Kubernetes token은 md-share 설치 계약에 포함되지 않는다. `MD_SHARE_UPLOAD_TOKEN`은
gateway나 batch 같은 headless client가 필요한 설치에서만 별도 secret으로 선택 설정한다.
이 token의 값, 생성과 회전 정책도 설치자가 결정한다.

## 관리자 console

`/admin/login`에서 설치자가 정한 ID/password로 로그인하면 `/admin` console을 사용할 수
있다. console은 문서 본문과 관리 token을 표시하지 않고 다음 기능만 제공한다.

- 활성 문서 수, 저장 byte와 만료 문서 수 확인
- 최근 활성 문서 최대 50건의 metadata 검색
- 렌더링 페이지와 raw Markdown 열기
- 확인 절차를 거친 문서 영구 삭제

관리자 session은 process memory에만 있고 browser에는 `HttpOnly`, `SameSite=Strict` cookie가
저장된다. 기본 만료는 8시간이며 process나 Pod를 다시 시작하면 모든 관리자가 logout된다.
`MD_SHARE_ADMIN_SESSION_TTL_SECONDS`로 최대 7일까지 설정할 수 있다.

Login 시도는 기본 client별 5회/5분, process 전체 50회/5분으로 제한한다. 다음 환경 변수로
설치 환경에 맞게 조정하고 반복되는 `429 ADMIN_LOGIN_RATE_LIMITED`를 관찰한다.

- `MD_SHARE_ADMIN_LOGIN_LIMIT`
- `MD_SHARE_ADMIN_LOGIN_GLOBAL_LIMIT`
- `MD_SHARE_ADMIN_LOGIN_WINDOW_SECONDS`

## 자동화 token

`MD_SHARE_UPLOAD_TOKEN`을 설정하면 headless client가 `Authorization: Bearer`로 최근 문서
목록, 상태, 강제 삭제와 인증된 upload를 호출할 수 있다. 이 token은 사람의 관리자 login
credential이나 문서별 관리 token이 아니다. 필요하지 않은 설치에서는 설정하지 않는다.

자동화 token을 사용하는 trusted gateway upload는 익명 제한을 적용받지 않는다. md-share는
gateway 제품별 protocol, DaouOffice 연동이나 message routing을 처리하지 않는다.

## Upgrade

1. 사용할 image tag와 digest를 확인해 배포 정의에 고정한다.
2. 아래 절차로 data 전체를 backup한다.
3. 새 image를 시작하고 `GET /openapi.yaml`과 관리자 console의 storage summary를 확인한다.
4. 임시 Markdown 문서를 upload하고 rendering URL과 raw URL을 확인한 뒤 문서 관리 token으로
   삭제한다.
5. 문제가 있으면 process를 중지하고 직전 image와 backup한 data 전체를 함께 복원한다.

여러 md-share process가 하나의 로컬 filesystem volume을 동시에 쓰는 구성은 지원하지
않는다.

## Backup과 복구

`MD_SHARE_DATA_DIR` 전체가 하나의 backup 단위다. Docker image에서는 `/data`다. 이
directory에는 Markdown 본문, 문서 metadata와 `.idempotency` 재시도 기록이 함께 있다.
일부 file만 복사하면 문서와 재시도 결과가 달라질 수 있다.

일관된 backup은 다음 중 하나로 만든다.

- md-share process를 중지한 뒤 data directory 전체를 복사한다.
- volume이 제공하는 원자적 filesystem snapshot을 사용한다.

복구할 때는 process를 중지하고 빈 data directory에 backup 전체를 복원한 뒤, service
사용자가 읽고 쓸 수 있는 권한을 적용한다. service를 시작한 후 관리자 console의 storage
summary와 표본 문서의 rendering·raw URL을 확인한다. 같은 `Idempotency-Key` 재시도는
backup에 포함된 `.idempotency` 기록을 기준으로 동작한다.

## 보안 운영

- 관리자 password와 선택적 `MD_SHARE_UPLOAD_TOKEN`은 secret store로 관리하고 log, image와
  저장소에 넣지 않는다.
- 익명 생성을 제공할 때는 client별·process 전체 제한과 기본 만료를 함께 설정하고 저장량과
  `429` 응답을 관찰한다.
- 공개 link는 bearer credential이다. link를 아는 사용자는 rendering 문서와 원문을 읽을 수
  있으므로 민감정보를 upload하지 않는다.
- `manageToken`은 생성 응답에서 한 번만 제공된다. Web UI는 현재 browser origin의 local
  storage에 저장하고, API client는 안전한 개인 저장소에 보관한다. 공유 URL, message와
  log에는 남기지 않는다.
- `My documents`는 account나 관리자 기능이 아니다. browser data를 지우면 로컬 관리 권한도
  사라지며 server는 token을 복구하지 않는다.
- md-share origin에는 신뢰한 application code만 제공한다. 같은 origin에서 실행되는
  JavaScript는 local storage의 관리 token을 읽을 수 있다.
- data volume에는 Markdown 평문과 token hash가 저장된다. volume과 backup 접근 권한을
  service 운영자에게만 부여한다.
- proxy와 application log에는 요청 본문, Authorization, cookie, 관리 token과 query string을
  기록하지 않는다.

## 상태 확인과 자동화 삭제

사람 운영자는 `/admin`에서 상태와 최근 문서를 확인하고 삭제한다. 자동화 token을 설정한
instance는 다음과 같이 같은 API를 headless하게 호출할 수 있다.

```bash
curl -fsS \
  -H "Authorization: Bearer $MD_SHARE_UPLOAD_TOKEN" \
  "https://md-share.example.com/api/status"

curl -fsS \
  -H "Authorization: Bearer $MD_SHARE_UPLOAD_TOKEN" \
  "https://md-share.example.com/api/documents"

curl -fsS -X DELETE \
  -H "Authorization: Bearer $MD_SHARE_UPLOAD_TOKEN" \
  "https://md-share.example.com/api/documents/<DOCUMENT_ID>"
```

`401 OPERATOR_AUTH_FAILED`는 관리자 session 또는 자동화 token을 확인한다. 익명 upload의
`429`가 반복되면 `X-RateLimit-Scope`로 client별 제한과 process 전체 제한 중 어떤 한도가
소진됐는지 확인한다. storage 오류가 반복되면 volume의 쓰기 권한과 여유 공간을 확인한 뒤
data directory 전체를 보존한 상태에서 진단한다.

관리자 session과 자동화 token은 문서 만료 변경에 사용할 수 없다. 만료 변경은 문서 생성 시
발급한 `manageToken`으로만 수행한다.
