import type {
  BillingPeriod,
  CommissionType,
  CustomerOrderStatus,
  LoyaltyRewardType,
  MarketplaceAdStatus,
  SmsStatus,
  SubscriptionStatus,
  TenantStatus,
  UserRole,
} from '@/lib/types';

export type StoredPassword = {
  salt: string;
  hash: string;
};

export type StoreLoyaltyProgram = {
  isEnabled: boolean;
  spendThreshold: number;
  rewardType: LoyaltyRewardType;
  rewardValue: number;
  rewardLabel?: string | null;
  notes?: string | null;
};

export type StoreTenant = {
  id: string;
  name: string;
  ownerName?: string | null;
  slug: string;
  logoUrl?: string | null;
  motto?: string | null;
  address?: string | null;
  storeNumber?: string | null;
  timezone: string;
  countryCode: string;
  currencyCode: string;
  status: TenantStatus;
  suspensionReason?: string | null;
  loyaltyProgram?: StoreLoyaltyProgram | null;
  createdAt: string;
  updatedAt: string;
};

export type StoreUser = {
  id: string;
  tenantId: string | null;
  role: UserRole;
  fullName: string;
  username: string;
  email: string;
  phone?: string;
  password: StoredPassword;
  passwordUpdatedAt?: string | null;
  isActive: boolean;
  commissionType?: CommissionType;
  commissionValue?: number;
  commissionNotes?: string;
  createdAt: string;
  updatedAt: string;
};

export type StoreCustomer = {
  id: string;
  tenantId: string;
  name: string;
  phone: string;
  phoneE164: string;
  notes?: string;
  marketingOptIn: boolean;
  archivedAt?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type StoreService = {
  id: string;
  tenantId: string;
  name: string;
  price: number;
  description?: string;
  imageUrl?: string | null;
  commissionType: CommissionType;
  commissionValue: number;
  durationMinutes?: number;
  isActive: boolean;
  createdBy: string;
  updatedBy: string;
  createdAt: string;
  updatedAt: string;
};

export type StoreProduct = {
  id: string;
  tenantId: string;
  name: string;
  unitCost: number;
  description?: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

export type StoreProductUsage = {
  productId: string;
  quantity: number;
  unitCost: number;
};

export type StoreServiceRecord = {
  id: string;
  tenantId: string;
  customerId: string;
  staffId: string;
  serviceId?: string | null;
  serviceName: string;
  isCustomService: boolean;
  price: number;
  description?: string;
  commissionType: CommissionType;
  commissionValue: number;
  commissionAmount: number;
  productUsages: StoreProductUsage[];
  performedAt: string;
  recordedBy: string;
  correctedAt?: string | null;
  correctedBy?: string | null;
  createdAt: string;
};

export type StoreExpense = {
  id: string;
  tenantId: string;
  category: string;
  description?: string;
  amount: number;
  expenseDate: string;
  createdBy: string;
  createdAt: string;
};

export type StoreSubscription = {
  id: string;
  tenantId: string;
  packageId?: string | null;
  planCode: string;
  status: SubscriptionStatus;
  startsAt: string;
  endsAt: string;
  graceEndsAt?: string | null;
  amount: number;
  currencyCode: string;
  autoRenew: boolean;
  paymentTerms?: string;
  updatedAt: string;
};

export type StoreSubscriptionPackage = {
  id: string;
  code: string;
  name: string;
  description?: string | null;
  features: string[];
  amount: number;
  currencyCode: string;
  billingPeriod: BillingPeriod;
  includesMarketplace: boolean;
  includesCustomerMarketplace: boolean;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

export type StoreSmsLog = {
  id: string;
  tenantId: string;
  customerId?: string;
  smsType: 'thank_you' | 'promotion' | 'system';
  recipientPhone: string;
  message: string;
  status: SmsStatus;
  sentAt?: string | null;
  createdAt: string;
};

export type StoreCommissionPayout = {
  id: string;
  tenantId: string;
  staffId: string;
  amount: number;
  periodStart: string;
  periodEnd: string;
  paidAt?: string | null;
  createdAt: string;
};

export type StoreSession = {
  id: string;
  userId: string;
  tenantId: string | null;
  role: UserRole;
  expiresAt: string;
  createdAt: string;
};

export type StoreCustomerSession = {
  id: string;
  customerId: string;
  tenantId: string;
  expiresAt: string;
  createdAt: string;
};

export type StoreMarketplaceAd = {
  id: string;
  tenantId: string;
  title: string;
  body: string;
  contactName: string;
  contactPhone: string;
  imageUrl?: string | null;
  status: MarketplaceAdStatus;
  approvalNotes?: string | null;
  createdBy: string;
  approvedBy?: string | null;
  approvedAt?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type StoreCustomerOrder = {
  id: string;
  tenantId: string;
  customerId: string;
  serviceId: string;
  serviceName: string;
  requestedStaffId?: string | null;
  requestedName: string;
  requestedPhone: string;
  notes?: string;
  status: CustomerOrderStatus;
  requestedAt: string;
  statusUpdatedAt?: string | null;
  createdAt: string;
};

export type StoreState = {
  tenants: StoreTenant[];
  users: StoreUser[];
  customers: StoreCustomer[];
  services: StoreService[];
  products: StoreProduct[];
  serviceRecords: StoreServiceRecord[];
  expenses: StoreExpense[];
  subscriptionPackages: StoreSubscriptionPackage[];
  subscriptions: StoreSubscription[];
  smsLogs: StoreSmsLog[];
  commissionPayouts: StoreCommissionPayout[];
  sessions: StoreSession[];
  customerSessions: StoreCustomerSession[];
  marketplaceAds: StoreMarketplaceAd[];
  customerOrders: StoreCustomerOrder[];
};
