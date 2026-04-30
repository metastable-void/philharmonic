import type { JSX } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";

import { clearToken } from "../store/authSlice";
import { useAppDispatch, useAppSelector } from "../store";

const navItems = [
  { to: "/", label: "Dashboard", end: true },
  { to: "/templates", label: "Templates" },
  { to: "/instances", label: "Instances" },
  { to: "/audit", label: "Audit" },
  { to: "/settings", label: "Settings" },
];

export default function Layout(): JSX.Element {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const token = useAppSelector((state) => state.auth.token);

  function logout(): void {
    dispatch(clearToken());
    navigate("/login", { replace: true });
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">P</span>
          <span>Philharmonic</span>
        </div>
        <nav className="nav" aria-label="Primary">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) => (isActive ? "nav-link active" : "nav-link")}
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="session-box">
          <div className="session-label">Token</div>
          <div className="session-token">{token.slice(0, 12)}...</div>
          <button className="button secondary full-width" type="button" onClick={logout}>
            Log out
          </button>
        </div>
      </aside>
      <main className="main-content">
        <Outlet />
      </main>
    </div>
  );
}
