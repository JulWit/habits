/**
 * @fileoverview Types of the parts of Vue the frontend uses, for the type
 * check only (see docs/BUILDING.md). The embedded build in web/assets/vendor
 * ships without its declarations; jsconfig.json maps it here through
 * `rootDirs`. Not embedded, not served.
 */

export interface Ref<T = any> {
  value: T;
}

export interface ComputedRef<T = any> {
  readonly value: T;
}

export type WatchSource<T = any> = Ref<T> | ComputedRef<T> | (() => T);

export interface WatchOptions {
  immediate?: boolean;
  deep?: boolean | number;
  flush?: 'pre' | 'post' | 'sync';
  once?: boolean;
}

export type StopHandle = () => void;

export function ref<T>(value: T): Ref<T>;
export function ref<T = any>(): Ref<T | undefined>;
export function shallowRef<T>(value: T): Ref<T>;
export function shallowRef<T = any>(): Ref<T | undefined>;
export function computed<T>(getter: () => T): ComputedRef<T>;
export function computed<T>(
    options: {get: () => T, set: (value: T) => void}): Ref<T>;
export function reactive<T extends object>(target: T): T;
export function shallowReactive<T extends object>(target: T): T;
export function markRaw<T extends object>(value: T): T;
export function toRaw<T>(value: T): T;

export function watch(
    source: WatchSource | ReadonlyArray<WatchSource | object> | object,
    callback: (value: any, oldValue: any,
               onCleanup: (cleanup: () => void) => void) => any,
    options?: WatchOptions): StopHandle;
export function watchEffect(
    effect: (onCleanup: (cleanup: () => void) => void) => void,
    options?: {flush?: 'pre' | 'post' | 'sync'}): StopHandle;

export function nextTick<T = void>(callback?: () => T): Promise<T>;

export function onMounted(hook: () => any): void;
export function onUnmounted(hook: () => any): void;
export function onBeforeUnmount(hook: () => any): void;
export function onBeforeUpdate(hook: () => any): void;
export function onUpdated(hook: () => any): void;
export function onScopeDispose(hook: () => void): void;

export function provide<T>(key: symbol | string, value: T): void;
export function inject<T = any>(key: symbol | string, fallback?: T): T;

export function h(type: any, props?: any, children?: any): any;

/** A component as the frontend writes it: an options object. */
export type Component = Record<string, any>;

/** A directive's hooks; `binding.value` is the bound expression's value. */
export interface Directive<E = HTMLElement, V = any> {
  mounted?(el: E, binding: {value: V, oldValue: V | null}): void;
  updated?(el: E, binding: {value: V, oldValue: V | null}): void;
  beforeUnmount?(el: E, binding: {value: V, oldValue: V | null}): void;
  unmounted?(el: E, binding: {value: V, oldValue: V | null}): void;
}

export interface App {
  component(name: string, component: Component): App;
  directive(name: string, directive: Directive<any, any>): App;
  mount(container: string | Element): any;
  config: {globalProperties: Record<string, any>};
}

export function createApp(root: Component): App;
export function defineAsyncComponent(
    options: {loader: () => Promise<Component>, onError?: Function}):
    Component;
