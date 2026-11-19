import React from 'react';
import './arcade-entry.css';

export function ArcadeIcon({ size = 24, strokeWidth = 1.7, ...props }) {
  return <svg width={size} height={size} viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
    <path d="M8 4h16v12l3 5v7H5v-7l3-5V4Z" />
    <path d="M8 8h16M5 21h22M14 25h4" />
    <rect x="11" y="11" width="10" height="5" rx="1" fill="currentColor" fillOpacity=".16" />
    <path d="M11 21v-3" />
    <circle cx="11" cy="17.5" r="1.3" fill="currentColor" stroke="none" />
    <circle cx="19" cy="18.5" r="1" fill="currentColor" stroke="none" />
    <circle cx="22" cy="18.5" r="1" fill="currentColor" stroke="none" />
  </svg>;
}

export default function ArcadeEntry({ onClick, className = '' }) {
  return <button type="button" className={`arcade-launcher ${className}`} title="游戏厅" aria-label="游戏厅" aria-haspopup="dialog" onClick={onClick}>
    <ArcadeIcon size={27} />
  </button>;
}
