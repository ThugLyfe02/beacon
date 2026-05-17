import React from 'react';
import { GlowButton } from './GlowButton';

interface Props {
  following: boolean;
  loading?: boolean;
  onPress: () => void;
  size?: 'sm' | 'md';
  fullWidth?: boolean;
}

export function FollowButton({ following, loading, onPress, size = 'sm', fullWidth }: Readonly<Props>) {
  return (
    <GlowButton
      label={following ? 'Following' : 'Follow'}
      variant={following ? 'secondary' : 'primary'}
      onPress={onPress}
      loading={loading}
      size={size}
      fullWidth={fullWidth}
    />
  );
}
