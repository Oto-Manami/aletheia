import { Navigate, type RouteObject } from "react-router";
import { useApp } from "./context.tsx";
import { IntakeDetailPage } from "./pages/IntakeDetail.tsx";
import { IntakePage } from "./pages/IntakeList.tsx";
import { Layout } from "./pages/Layout.tsx";
import { PostPage } from "./pages/Post.tsx";
import { SearchPage } from "./pages/Search.tsx";

function Home() {
  const { viewer } = useApp();
  return <Navigate to={viewer.isAdmin ? "/intake" : "/search"} replace />;
}

function NotFound() {
  return (
    <section className="page narrow">
      <h1 className="page-title">ページが見つかりません</h1>
      <p>URL を確かめるか、左の一覧から選んでください。</p>
    </section>
  );
}

// Discord の承認カードの「編集」は /intake/:id を開く
export const routes: RouteObject[] = [
  {
    element: <Layout />,
    children: [
      { index: true, element: <Home /> },
      {
        path: "intake",
        element: <IntakePage />,
        children: [{ path: ":id", element: <IntakeDetailPage /> }],
      },
      { path: "search", element: <SearchPage /> },
      { path: "posts/:id", element: <PostPage /> },
      { path: "*", element: <NotFound /> },
    ],
  },
];
