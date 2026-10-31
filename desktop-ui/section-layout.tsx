'use client';

import { Children, Fragment, cloneElement, createContext, isValidElement, useContext, useEffect, useRef, useState, type HTMLAttributes, type ReactElement, type ReactNode, type Ref } from 'react';
import { ArrowDown, ArrowUp, GripVertical } from 'lucide-react';
import './section-layout.css';

type Orders = Record<string, string[]>;
type LayoutContext = { page: string; arranging: boolean; enabled: boolean; busy: boolean; orders: Orders; save: (group: string, order: string[]) => void };
const Context = createContext<LayoutContext | null>(null);
const prefix = 'opscenter-section-layout-v1:';
function readOrders(page: string): Orders {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(prefix + page) || '{}');
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return Object.fromEntries(Object.entries(value).filter(([key, ids]) => key.length < 160 && Array.isArray(ids) && ids.length <= 100 && ids.every(id => typeof id === 'string' && id.length < 160)).map(([key, ids]) => [key, [...new Set(ids as string[])]]));
  } catch { return {}; }
}
export function SectionLayoutProvider({ page, busy, children }: { page: string; busy: boolean; children: ReactNode }) {
  const [enabled, setEnabled] = useState(false);
  const [arranging, setArranging] = useState(false);
  const [state, setState] = useState<{page: string; orders: Orders}>({page, orders: {}});
  const [message, setMessage] = useState('');
  useEffect(() => {
    const media = matchMedia('(min-width: 901px)');
    const update = () => {setEnabled(media.matches); if (!media.matches) setArranging(false);};
    update(); media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  useEffect(() => { setState({page, orders: readOrders(page)}); setArranging(false); setMessage(''); }, [page]);
  const orders = state.page === page ? state.orders : {};
  function persist(next: Orders) {
    setState({page, orders: next});
    try {localStorage.setItem(prefix + page, JSON.stringify(next)); setMessage('Layout saved for this browser.');}
    catch {setMessage('Layout changed for this visit. This browser could not save it.');}
  }
  return <Context.Provider value={{page, arranging: arranging && enabled && !busy, enabled, busy, orders, save: (group, order) => {if (!busy) persist({...orders, [group]: order});}}}>
    {children}
    {enabled && <div className="section-layout-toolbar" data-gesture-ignore>
      <button type="button" disabled={busy} aria-pressed={arranging} onClick={() => {setArranging(!arranging); setMessage('');}}><GripVertical size={14}/>{arranging ? 'Done arranging' : 'Arrange sections'}</button>
      {arranging && <><span>Drag a grip, or use its arrow buttons.</span><button type="button" disabled={busy} onClick={() => persist({})}>Reset this page</button></>}
      <span role="status">{message}</span>
    </div>}
  </Context.Provider>;
}

type ItemProps = HTMLAttributes<HTMLElement> & { 'data-layout-id'?: string; 'data-layout-label'?: string; children?: ReactNode };
function flatten(children: ReactNode, path = ''): ReactNode[] {
  const result: ReactNode[] = [];
  Children.forEach(children, (child, index) => {
    if (isValidElement<ItemProps>(child) && child.type === Fragment) result.push(...flatten(child.props.children, `${path}${index}.`));
    else if (isValidElement<ItemProps>(child)) result.push(cloneElement(child, {key: child.key || child.props['data-layout-id'] || `${path}${index}`}));
    else result.push(child);
  });
  return result;
}

/** Reorders keyed React siblings; never reparents React-owned DOM or touches records. */
export function SectionLayout({ as: Tag = 'div', group, children, ref: forwardedRef, ...props }: HTMLAttributes<HTMLElement> & { as?: 'div' | 'section' | 'aside'; group: string; children?: ReactNode; ref?: Ref<HTMLElement> }) {
  const layout = useContext(Context);
  const root = useRef<HTMLElement | null>(null);
  const dragged = useRef<string | null>(null);
  const [target, setTarget] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const nodes = flatten(children);
  const candidates = nodes.filter((node): node is ReactElement<ItemProps> => isValidElement<ItemProps>(node) && Boolean(node.props['data-layout-id']));
  const items = candidates.filter(item => candidates.filter(other => other.props['data-layout-id'] === item.props['data-layout-id']).length === 1);
  const ids = items.map(item => item.props['data-layout-id']!);
  const stored = layout?.enabled ? layout.orders[group] || [] : [];
  const order = [...stored.filter(id => ids.includes(id)), ...ids.filter(id => !stored.includes(id))];
  const arranged = new Map(items.map(item => [item.props['data-layout-id']!, item]));
  const editing = Boolean(layout?.arranging && items.length > 1);
  const label = (id: string) => {
    const item = items.find(item => item.props['data-layout-id'] === id);
    const element = Array.from(root.current?.children || []).find(child => child.getAttribute('data-layout-id') === id);
    return item?.props['data-layout-label'] || element?.querySelector('h2,h3,summary')?.textContent?.trim() || item?.props['aria-label'] || id.replaceAll('-', ' ');
  };
  function move(id: string, destination: number) {
    if (!editing || destination < 0 || destination >= order.length) return;
    const next = order.filter(value => value !== id); next.splice(destination, 0, id);
    layout?.save(group, next); setAnnouncement(`${label(id)} moved to position ${destination + 1} of ${order.length}.`);
    requestAnimationFrame(() => Array.from(root.current?.querySelectorAll<HTMLButtonElement>('[data-layout-grip]') || []).find(button => button.dataset.layoutGrip === id)?.focus({preventScroll: true}));
  }
  let cursor = 0;
  return <Tag {...props} ref={element => { root.current = element; if (typeof forwardedRef === 'function') forwardedRef(element); else if (forwardedRef) forwardedRef.current = element; }} data-layout-group={group} data-layout-editing={editing || undefined}
    onDragOver={event => {
      if (!editing || !dragged.current || !(event.target instanceof Element)) return;
      let item: Element | null = event.target;
      while (item && item.parentElement !== root.current) item = item.parentElement;
      if (!item?.hasAttribute('data-layout-id')) return;
      event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = 'move'; setTarget(item.getAttribute('data-layout-id'));
    }} onDrop={event => {
      if (!editing || !dragged.current || !(event.target instanceof Element)) return;
      let item: Element | null = event.target;
      while (item && item.parentElement !== root.current) item = item.parentElement;
      if (!item?.hasAttribute('data-layout-id')) return;
      event.preventDefault(); event.stopPropagation(); move(dragged.current, order.indexOf(item.getAttribute('data-layout-id')!)); dragged.current = null; setTarget(null);
    }}>
    {nodes.map(node => {
      if (!isValidElement<ItemProps>(node) || !ids.includes(node.props['data-layout-id'] || '')) return node;
      const item = arranged.get(order[cursor++])!;
      const id = item.props['data-layout-id']!, index = order.indexOf(id);
      return cloneElement(item, {className: `${item.props.className || ''} section-layout-item${target === id ? ' section-layout-target' : ''}`, children: <>{item.props.children}{editing && <div className="section-layout-tools" data-gesture-ignore onClick={event => event.stopPropagation()}>
        <button type="button" draggable data-layout-grip={id} aria-label={`Move ${label(id)}`} title="Drag to move. Arrow Up or Down also moves this section."
          onDragStart={event => {event.stopPropagation(); dragged.current = id; event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', id); if (event.currentTarget.parentElement?.parentElement) event.dataTransfer.setDragImage(event.currentTarget.parentElement.parentElement, 20, 20);}}
          onDragEnd={() => {dragged.current = null; setTarget(null);}}
          onKeyDown={event => {if (['ArrowUp','ArrowDown','Home','End'].includes(event.key)) {event.preventDefault(); event.stopPropagation(); move(id, event.key === 'Home' ? 0 : event.key === 'End' ? order.length - 1 : index + (event.key === 'ArrowUp' ? -1 : 1));}}}><GripVertical size={16}/><span>{label(id)}</span></button>
        <button type="button" disabled={index === 0} aria-label={`Move ${label(id)} up`} onClick={() => move(id, index - 1)}><ArrowUp size={14}/></button>
        <button type="button" disabled={index === order.length - 1} aria-label={`Move ${label(id)} down`} onClick={() => move(id, index + 1)}><ArrowDown size={14}/></button>
      </div>}</>});
    })}
    {editing && <span className="sr-only" role="status">{announcement}</span>}
  </Tag>;
}
