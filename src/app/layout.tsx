import type { ReactNode } from "react";

export const metadata = {
  title: "로컬 노포찾기",
  description: "네이버 지역/블로그 API를 서버 프록시로 호출하는 로컬 노포찾기",
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

