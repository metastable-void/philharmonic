import type { JSX } from "react";
import { Navigate, Outlet, useLocation } from "react-router-dom";

import { useAppSelector } from "../store";

export default function ProtectedRoute(): JSX.Element {
  const isAuthenticated = useAppSelector((state) => state.auth.isAuthenticated);
  const location = useLocation();

  if (!isAuthenticated) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  return <Outlet />;
}
