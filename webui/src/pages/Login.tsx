import { type FormEvent, type JSX, useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";

import { setToken } from "../store/authSlice";
import { useAppDispatch, useAppSelector } from "../store";

interface LoginLocationState {
  from?: {
    pathname?: string;
  };
}

export default function Login(): JSX.Element {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const location = useLocation();
  const isAuthenticated = useAppSelector((state) => state.auth.isAuthenticated);
  const [tokenInput, setTokenInput] = useState("");
  const [error, setError] = useState<string | null>(null);

  const state = location.state as LoginLocationState | null;
  const redirectTo = state?.from?.pathname ?? "/";

  if (isAuthenticated) {
    return <Navigate to={redirectTo} replace />;
  }

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const token = tokenInput.trim();
    if (!token.startsWith("pht_")) {
      setError("Token must start with pht_.");
      return;
    }

    dispatch(setToken(token));
    navigate(redirectTo, { replace: true });
  }

  return (
    <main className="login-screen">
      <section className="login-panel" aria-labelledby="login-title">
        <div className="brand login-brand">
          <span className="brand-mark">P</span>
          <span>Philharmonic</span>
        </div>
        <h1 id="login-title">API token login</h1>
        <form className="stack" onSubmit={submit}>
          <label className="field">
            <span>Long-lived API token</span>
            <input
              autoFocus
              type="text"
              value={tokenInput}
              onChange={(event) => {
                setTokenInput(event.target.value);
                setError(null);
              }}
              placeholder="pht_..."
              autoComplete="off"
            />
          </label>
          {error !== null && <div className="alert error">{error}</div>}
          <button className="button primary" type="submit">
            Login
          </button>
        </form>
      </section>
    </main>
  );
}
