import { createSlice, type PayloadAction } from "@reduxjs/toolkit";

const TOKEN_STORAGE_KEY = "philharmonic.webui.token";

export interface AuthState {
  token: string;
  isAuthenticated: boolean;
}

function storedToken(): string {
  if (typeof window === "undefined") {
    return "";
  }

  try {
    return window.sessionStorage.getItem(TOKEN_STORAGE_KEY) ?? "";
  } catch {
    return "";
  }
}

export function persistToken(token: string): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    if (token.length === 0) {
      window.sessionStorage.removeItem(TOKEN_STORAGE_KEY);
    } else {
      window.sessionStorage.setItem(TOKEN_STORAGE_KEY, token);
    }
  } catch {
    // Browsers can deny sessionStorage; Redux still carries the token in-memory.
  }
}

const initialToken = storedToken();

const initialState: AuthState = {
  token: initialToken,
  isAuthenticated: initialToken.length > 0,
};

export const authSlice = createSlice({
  name: "auth",
  initialState,
  reducers: {
    setToken(state, action: PayloadAction<string>) {
      const token = action.payload.trim();
      state.token = token;
      state.isAuthenticated = token.length > 0;
    },
    clearToken(state) {
      state.token = "";
      state.isAuthenticated = false;
    },
  },
});

export const { clearToken, setToken } = authSlice.actions;
export default authSlice.reducer;
