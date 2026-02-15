/**
 * Frontend Navigation Service — manages app navigation, state, and registered callbacks.
 * Provides registerCallback() for dynamic UI ↔ Agent integration.
 */

export class FrontendNavigationService {
    private currentState = { tab: 'home', subtab: '', category: '', selectedItem: '' };
    private callbacks: Map<string, (...args: any[]) => any> = new Map();

    // ── Navigation ──

    switchView(view: string): void {
        this.currentState.tab = view;
    }

    getCurrentView(): string {
        return this.currentState.tab;
    }

    navigate(path: string): void {
        this.currentState.tab = path;
    }

    getAppStructure(): Record<string, any> {
        return { tabs: ['home', 'categories', 'search', 'settings'], current: this.currentState.tab };
    }

    getAppStructureDescription(): string {
        return 'Application with tabs: Home, Categories, Search, Settings';
    }

    getCurrentState(): Record<string, any> {
        return { ...this.currentState };
    }

    async getScreenContext(): Promise<Record<string, any>> {
        return { ...this.currentState, timestamp: Date.now() };
    }

    getAvailableActions(): string[] {
        return ['navigate_to_tab', 'select_category', 'search_ui', ...Array.from(this.callbacks.keys())];
    }

    navigateToTab(tabId: string): Record<string, any> {
        this.currentState.tab = tabId;
        this.invokeCallback('setActiveTab', tabId);
        return { success: true, tab: tabId };
    }

    navigateToSubTab(tabId: string, subTabId: string): Record<string, any> {
        this.currentState.tab = tabId;
        this.currentState.subtab = subTabId;
        this.invokeCallback('setActiveTab', tabId);
        this.invokeCallback('setActiveSubTab', subTabId);
        return { success: true, tab: tabId, subtab: subTabId };
    }

    selectCategory(categoryId: string): Record<string, any> {
        this.currentState.category = categoryId;
        this.invokeCallback('setSelectedCategory', categoryId);
        return { success: true, category: categoryId };
    }

    selectItem(itemId: string): Record<string, any> {
        this.currentState.selectedItem = itemId;
        this.invokeCallback('setSelectedItem', itemId);
        return { success: true, item: itemId };
    }

    async search(query: string): Promise<Record<string, any>> {
        this.invokeCallback('setSearchQuery', query);
        return { success: true, query, results: [] };
    }

    // ── Callback Registry ──

    /** Register a callback function by name (used by useFrontendIntegration hook) */
    registerCallback(name: string, fn: (...args: any[]) => any): void {
        this.callbacks.set(name, fn);
    }

    /** Unregister a callback */
    unregisterCallback(name: string): void {
        this.callbacks.delete(name);
    }

    /** Invoke a registered callback */
    invokeCallback(name: string, ...args: any[]): any {
        const cb = this.callbacks.get(name);
        if (cb) {
            try { return cb(...args); }
            catch (e) { console.warn(`[FrontendNav] Callback '${name}' error:`, e); }
        }
        return undefined;
    }

    /** Check if a callback is registered */
    hasCallback(name: string): boolean {
        return this.callbacks.has(name);
    }

    // ── Dynamic actions (used by ToolExecutionService) ──

    /** Apply filters to current view */
    applyFilters(filters: Record<string, any>): Record<string, any> {
        const cb = this.callbacks.get('applyFilters');
        if (cb) return cb(filters);
        return { success: true, filters, applied: false, note: 'No callback registered' };
    }

    /** Get data from the current screen */
    getScreenData(): any {
        const cb = this.callbacks.get('getScreenData');
        if (cb) return cb();
        return { ...this.currentState, timestamp: Date.now() };
    }

    /** Get currently selected items */
    getSelectedItems(): any {
        const cb = this.callbacks.get('getSelectedItems');
        if (cb) return cb();
        return { items: [], categories: [], other: {} };
    }

    /** Click/activate an element by selector or ID */
    clickElement(selector: string): Record<string, any> {
        const cb = this.callbacks.get(`click_${selector}`) || this.callbacks.get('clickElement');
        if (cb) return cb(selector);
        return { success: false, error: `No click handler for '${selector}'` };
    }
}

export const frontendNavigationService = new FrontendNavigationService();
