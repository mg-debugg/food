import type { ReactNode } from "react";

export const metadata = {
  title: "수원 로컬 맛집 찾기 (MVP)",
  description: "네이버 지역검색 API를 서버 프록시로 호출하는 MVP",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ko">
      <body style={{ margin: 0, fontFamily: "system-ui, -apple-system, Segoe UI, Arial" }}>
        {children}
      </body>
    </html>
  );
}

