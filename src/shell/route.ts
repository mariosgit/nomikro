// The route lives in the URL hash: #/<app>/<path>?<params>, e.g. #/lab/buttons?values=1,2,4
// Hash routing works on any static host (GitHub Pages) without server rewrites.

export interface Route {
    app: string;
    path: string;
    params: Record<string, string>;
}

export const toHash = ({ app, path, params }: Route) => {
    const query = new URLSearchParams(params).toString();
    return `#/${app}${path ? `/${path}` : ''}${query ? `?${query}` : ''}`;
};

export const parseHash = (hash: string): Route => {
    const [fullPath, query = ''] = hash.replace(/^#\/?/, '').split('?');
    const [app = '', ...rest] = fullPath.split('/');
    return { app, path: rest.join('/'), params: Object.fromEntries(new URLSearchParams(query)) };
};
