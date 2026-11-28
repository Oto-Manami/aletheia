// 画面ごとにプログラムを分け、開いたときに読む（設計書 決定記録 0062）。枠（Layout）だけは最初に読む
import { type ComponentType, lazy } from "react";
import { Navigate, type RouteObject, useParams, useSearchParams } from "react-router";
import { useApp } from "./context.tsx";
import { Layout } from "./pages/Layout.tsx";
import { triageRouteOf } from "./triage-routes.ts";

/** 画面のモジュールの名前付きの部品を、開いたときに読む */
function page<M, K extends keyof M>(load: () => Promise<M>, name: K) {
  return lazy(() => load().then((m) => ({ default: m[name] as ComponentType })));
}

const pages = {
  assets: () => import("./pages/Assets.tsx"),
  dashboard: () => import("./pages/Dashboard.tsx"),
  duplicates: () => import("./pages/Duplicates.tsx"),
  events: () => import("./pages/Events.tsx"),
  eventView: () => import("./pages/EventView.tsx"),
  intake: () => import("./pages/IntakeList.tsx"),
  intakeDetail: () => import("./pages/IntakeDetail.tsx"),
  members: () => import("./pages/Members.tsx"),
  people: () => import("./pages/People.tsx"),
  settings: () => import("./pages/Settings.tsx"),
  post: () => import("./pages/Post.tsx"),
  postEdit: () => import("./pages/PostEdit.tsx"),
  search: () => import("./pages/Search.tsx"),
  songs: () => import("./pages/Songs.tsx"),
  triage: () => import("./pages/Triage.tsx"),
  works: () => import("./pages/Works.tsx"),
};
const AssetsPage = page(pages.assets, "AssetsPage");
const DashboardPage = page(pages.dashboard, "DashboardPage");
const DuplicatesPage = page(pages.duplicates, "DuplicatesPage");
const EventsPage = page(pages.events, "EventsPage");
const EventsEmpty = page(pages.events, "EventsEmpty");
const EventEditPage = page(pages.events, "EventEditPage");
const EventViewPage = page(pages.eventView, "EventViewPage");
const IntakePage = page(pages.intake, "IntakePage");
const IntakeDetailPage = page(pages.intakeDetail, "IntakeDetailPage");
const MembersPage = page(pages.members, "MembersPage");
const PeoplePage = page(pages.people, "PeoplePage");
const SettingsPage = page(pages.settings, "SettingsPage");
const DisplaySettings = page(pages.settings, "DisplaySettings");
const PostPage = page(pages.post, "PostPage");
const PostEditPage = page(pages.postEdit, "PostEditPage");
const SearchPage = page(pages.search, "SearchPage");
const SongsPage = page(pages.songs, "SongsPage");
const TriagePage = page(pages.triage, "TriagePage");
const WorksPage = page(pages.works, "WorksPage");

function Home() {
  const { viewer } = useApp();
  // 作業者・運営者はダッシュボードから（決定記録 0063）、閲覧者はアセットから、登録の無い人は検索から（決定記録 0032）
  const home = viewer.canWork ? "/dashboard" : viewer.isMember ? "/assets" : "/search";
  return <Navigate to={home} replace />;
}

/**
 * 振り分けは、ブログとニュースで画面を分ける（決定記録 0038）。/triage と、分ける前の ?source=news は
 * それぞれの画面へ送る
 */
function TriageIndex() {
  const [params] = useSearchParams();
  const next = new URLSearchParams(params);
  next.delete("source");
  const query = next.toString();
  const route = params.get("source") === "news" ? "news" : "blog";
  return <Navigate to={`/triage/${route}${query ? `?${query}` : ""}`} replace />;
}

function TriageRouteGuard() {
  const { route } = useParams();
  // ルートを移ったら、選んだものなどの状態を持ち越さない
  if (triageRouteOf(route)) return <TriagePage key={route} />;
  return <Navigate to="/triage/blog" replace />;
}

function NotFound() {
  return (
    <section className="page narrow">
      <h1 className="page-title">ページが見つかりません</h1>
      <p>URL を確かめるか、左の一覧から選んでください。</p>
    </section>
  );
}

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
      {
        path: "triage",
        children: [
          { index: true, element: <TriageIndex /> },
          { path: ":route", element: <TriageRouteGuard /> },
        ],
      },
      {
        path: "events",
        element: <EventsPage />,
        children: [
          { index: true, element: <EventsEmpty /> },
          // /events/new は作る画面。/events/:id は表示の画面で、「編集」から /events/:id/edit に移る
          { path: "new", element: <EventEditPage /> },
          { path: ":id", element: <EventViewPage /> },
          { path: ":id/edit", element: <EventEditPage /> },
        ],
      },
      { path: "dashboard", element: <DashboardPage /> },
      { path: "duplicates", element: <DuplicatesPage /> },
      { path: "assets", element: <AssetsPage /> },
      { path: "songs", element: <SongsPage /> },
      { path: "songs/:id", element: <SongsPage /> },
      { path: "people", element: <PeoplePage /> },
      { path: "people/:id", element: <PeoplePage /> },
      { path: "works", element: <WorksPage /> },
      { path: "works/:id", element: <WorksPage /> },
      { path: "search", element: <SearchPage /> },
      { path: "posts/:id", element: <PostPage /> },
      { path: "posts/:id/edit", element: <PostEditPage /> },
      {
        path: "settings",
        element: <SettingsPage />,
        children: [
          { index: true, element: <DisplaySettings /> },
          { path: "members", element: <MembersPage /> },
        ],
      },
      { path: "members", element: <Navigate to="/settings/members" replace /> },
      // 招待リンクで開いた後（登録済みなら最初の画面へ）
      { path: "invite", element: <Navigate to="/" replace /> },
      { path: "*", element: <NotFound /> },
    ],
  },
];
