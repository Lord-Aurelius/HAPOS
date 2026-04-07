import type { Tenant } from '@/lib/types';

type BusinessAvatarProps = {
  tenant: Tenant;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
};

function getBusinessInitials(name: string) {
  const parts = name
    .split(/\s+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .slice(0, 2);

  if (parts.length === 0) {
    return 'HA';
  }

  return parts.map((part) => part.charAt(0).toUpperCase()).join('');
}

export function BusinessAvatar({ tenant, size = 'md', className }: BusinessAvatarProps) {
  const initials = getBusinessInitials(tenant.name);
  const classes = ['business-avatar', `is-${size}`, className].filter(Boolean).join(' ');

  if (tenant.logoUrl) {
    return (
      <span className={classes}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={tenant.logoUrl} alt={`${tenant.name} logo`} className="business-avatar-image" />
      </span>
    );
  }

  return (
    <span className={classes} aria-label={`${tenant.name} monogram`}>
      <span>{initials}</span>
    </span>
  );
}
