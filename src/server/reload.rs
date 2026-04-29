use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};

use tokio::signal::unix::{SignalKind, signal};
use tokio::sync::{Notify, watch};

/// A handle that watches for SIGHUP and notifies waiters.
pub struct ReloadHandle {
    state: Arc<ReloadState>,
    seen: Arc<AtomicU64>,
}

struct ReloadState {
    notify: Notify,
    generation: AtomicU64,
    _shutdown: watch::Sender<()>,
}

impl Clone for ReloadHandle {
    fn clone(&self) -> Self {
        Self {
            state: Arc::clone(&self.state),
            seen: Arc::new(AtomicU64::new(self.seen.load(Ordering::Acquire))),
        }
    }
}

impl ReloadHandle {
    /// Create a new handle and spawn the signal listener task.
    /// Must be called from within a tokio runtime.
    pub fn new() -> std::io::Result<Self> {
        let mut signals = signal(SignalKind::hangup())?;
        let (shutdown, mut shutdown_rx) = watch::channel(());
        let state = Arc::new(ReloadState {
            notify: Notify::new(),
            generation: AtomicU64::new(0),
            _shutdown: shutdown,
        });
        let weak_state = Arc::downgrade(&state);

        tokio::spawn(async move {
            loop {
                tokio::select! {
                    signal = signals.recv() => {
                        if signal.is_none() {
                            break;
                        }

                        let Some(state) = weak_state.upgrade() else {
                            break;
                        };
                        state.generation.fetch_add(1, Ordering::AcqRel);
                        state.notify.notify_waiters();
                    }
                    changed = shutdown_rx.changed() => {
                        if changed.is_err() {
                            break;
                        }
                    }
                }
            }
        });

        Ok(Self {
            state,
            seen: Arc::new(AtomicU64::new(0)),
        })
    }

    /// Wait for the next SIGHUP. Returns immediately if one has
    /// been received since the last call.
    pub async fn notified(&self) {
        loop {
            let seen = self.seen.load(Ordering::Acquire);
            let current = self.state.generation.load(Ordering::Acquire);
            if current != seen {
                self.seen.store(current, Ordering::Release);
                return;
            }

            let mut notified = Box::pin(self.state.notify.notified());
            notified.as_mut().enable();

            let current = self.state.generation.load(Ordering::Acquire);
            if current != seen {
                self.seen.store(current, Ordering::Release);
                return;
            }

            notified.await;
        }
    }
}

#[cfg(test)]
mod tests {
    use std::process::Command;
    use std::time::Duration;

    use tokio::time::timeout;

    use super::ReloadHandle;

    #[tokio::test]
    #[ignore = "sends SIGHUP to the current process"]
    async fn sighup_notifies() {
        let handle = ReloadHandle::new().unwrap();
        let waiter = handle.notified();

        let status = Command::new("kill")
            .arg("-HUP")
            .arg(std::process::id().to_string())
            .status()
            .unwrap();
        assert!(status.success());

        timeout(Duration::from_secs(5), waiter).await.unwrap();
    }
}
