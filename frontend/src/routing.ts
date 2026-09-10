export type AppRoute =
  | "dashboard"
  | "progress"
  | "records"
  | "hale"
  | "profile"
  | "profile-setup"
  | "settings"
  | "tutorial"
  | "not-found";

const paths: Record<Exclude<AppRoute, "not-found">, string> = {
  dashboard: "/dashboard",
  progress: "/dashboard/progress",
  records: "/dashboard/records",
  hale: "/dashboard/hale",
  profile: "/profile",
  "profile-setup": "/profile/setup",
  settings: "/settings",
  tutorial: "/tutorial"
};

export function appRouteFromPath(pathname: string): AppRoute {
  const entry = Object.entries(paths).find(([, path]) => path === pathname);
  return entry ? entry[0] as Exclude<AppRoute, "not-found"> : "not-found";
}

export function appPath(route: Exclude<AppRoute, "not-found">): string {
  return paths[route];
}

export function isEntryPath(pathname: string): boolean {
  return pathname === "/" || pathname === "/access";
}

export function isDashboardRoute(route: AppRoute): boolean {
  return route === "dashboard" || route === "progress" || route === "records" || route === "hale";
}
