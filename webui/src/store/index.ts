import { configureStore } from "@reduxjs/toolkit";
import { useDispatch, useSelector } from "react-redux";

import authReducer, { persistToken } from "./authSlice";

export const store = configureStore({
  reducer: {
    auth: authReducer,
  },
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;

export const useAppDispatch = useDispatch.withTypes<AppDispatch>();
export const useAppSelector = useSelector.withTypes<RootState>();

let lastToken = store.getState().auth.token;
store.subscribe(() => {
  const token = store.getState().auth.token;
  if (token !== lastToken) {
    lastToken = token;
    persistToken(token);
  }
});
