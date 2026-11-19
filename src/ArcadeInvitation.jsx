import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { api } from './api';
import { ArcadeIcon } from './ArcadeEntry';

export default function ArcadeInvitation({ userId, onOpen, hidden = false }) {
  const [invitations, setInvitations] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [portal, setPortal] = useState(document.body);
  const alive = useRef(false);
  const serial = useRef(0);
  useEffect(() => {
    if (!invitations.length || hidden) { setPortal(document.body); return; }
    const update = () => setPortal(document.querySelector('dialog[open]') || document.body);
    const observer = new MutationObserver(update);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['open'] });
    update();
    return () => observer.disconnect();
  }, [Boolean(invitations.length), hidden]);
  useEffect(() => {
    alive.current = true;
    const load = async () => {
      const ticket = ++serial.current;
      try { const data = await api('arcade/invitations'); if (alive.current && ticket === serial.current) setInvitations(data.invitations); } catch {}
    };
    load();
    const timer = setInterval(load, 30000);
    window.addEventListener('linliao:arcade-invitation', load);
    window.addEventListener('linliao:resume', load);
    return () => { alive.current = false; ++serial.current; clearInterval(timer); window.removeEventListener('linliao:arcade-invitation', load); window.removeEventListener('linliao:resume', load); };
  }, [userId]);
  const invite = invitations[0];
  const respond = async accept => {
    if (busy) return;
    setBusy(true); setError(''); ++serial.current;
    try {
      const result = await api('arcade/respond', { invitationId: invite.id, accept });
      if (!alive.current) return;
      ++serial.current;
      setInvitations(result.invitations || []);
      if (accept) { onOpen(); window.dispatchEvent(new CustomEvent('linliao:arcade-joined', { detail: { id: result.table?.id } })); }
    } catch (failure) { if (alive.current) setError(failure.message); }
    finally { if (alive.current) setBusy(false); }
  };
  if (!invite || hidden) return null;
  return createPortal(<aside className="arcade-invitation" aria-label="牌桌邀请" role="status">
    <ArcadeIcon size={25} /><div><b>{invite.fromName} 邀请你一起玩</b><span>{invite.tableName}</span>{error && <small role="alert">{error}</small>}</div>
    <button className="arcade-invitation-accept" disabled={busy} onClick={() => respond(true)}>加入牌桌</button>
    <button aria-label="谢绝牌桌邀请" disabled={busy} onClick={() => respond(false)}><X size={17} /></button>
  </aside>, portal);
}
