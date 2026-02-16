# 로컬 맛집 찾기

로컬에서 실행하려면 루트에 `.env.local` 파일을 만들고 아래 값을 채우세요:

```
NAVER_CLIENT_ID=your_client_id
NAVER_CLIENT_SECRET=your_client_secret
```

설치 및 실행:

```bash
npm install
npm run dev
```

요구사항 요약:
- `/api/naver/local` 서버 라우트에서만 네이버 OpenAPI를 호출합니다.
- 클라이언트에는 키/시크릿이 포함되지 않습니다.
- 검색어는 서버에서 `수원 ` 접두사가 자동으로 붙습니다.
