import { useEffect, useState } from 'react';

/** Load one section's data; each section loads and fails on its own. */
export function useSection(load, deps) {
  const [state, setState] = useState({ loading: true, data: null, error: null });
  useEffect(() => {
    let live = true;
    setState({ loading: true, data: null, error: null });
    load()
      .then((data) => { if (live) setState({ loading: false, data, error: null }); })
      .catch((e) => { if (live) setState({ loading: false, data: null, error: e.message || 'Could not load this section.' }); });
    return () => { live = false; };
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps
  return state;
}
