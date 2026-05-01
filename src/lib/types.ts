export type UserRole = 'super_admin' | 'shop_admin' | 'staff';

export type TenantStatus = 'active' | 'suspended' | 'inactive';

export type SubscriptionStatus =
  | 'trialing'
  | 'active'
  | 'past_due'
  | 'expired'
  | 'suspended'
  | 'cancelled';

export type BillingPeriod = 'monthly' | 'quarterly' | 'annual' | 'custom';

export type CommissionType = 'fixed' | 'percentage';

export type SmsKind = 'thank_you' | 'promotion' | 'system';

export type SmsStatus = 'queued' | 'sent' | 'failed';

export type MarketplaceAdStatus = 'pending' | 'approved' | 'rejected';

export type LoyaltyRewardType = 'free_service' | 'subsidized_service';

export type CustomerOrderStatus = 'pending' | 'acknowledged' | 'approved' | 'cancelled';

export type LoyaltyProgram = {
  isEnabled: boolean;
  spendThreshold: number;
  rewardType: LoyaltyRewardType;
  rewardValue: number;
  rewardLabel?: string | null;
  notes?: string | null;
};

export type Tenant = {
  id: string;
  name: string;
  slug: string;
  timezone: string;
  countryCode: string;
  currencyCode: string;
  status: TenantStatus;
  suspensionReason?: string | null;
  ownerName?: string | null;
  logoUrl?: string | null;
  motto?: string | null;
  address?: string | null;
  storeNumber?: string | null;
  loyaltyProgram?: LoyaltyProgram | null;
};

export type User = {
  id: string;
  tenantId: string | null;
  fullName: string;
  username: string;
  email: string;
  phone?: string;
  role: UserRole;
  isActive: boolean;
  commissionType?: CommissionType;
  commissionValue?: number;
  commissionNotes?: string;
};

export type Service = {
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
};

export type Product = {
  id: string;
  tenantId: string;
  name: string;
  unitCost: number;
  description?: string;
  isActive: boolean;
};

export type ProductUsage = {
  productId: string;
  productName: string;
  quantity: number;
  unitCost: number;
  totalCost: number;
};

export type Customer = {
  id: string;
  tenantId: string;
  name: string;
  phone: string;
  phoneE164: string;
  notes?: string;
  marketingOptIn: boolean;
  totalVisits?: number;
  lifetimeValue?: number;
  lastVisitAt?: string | null;
  archivedAt?: string | null;
};

export type ServiceRecord = {
  id: string;
  tenantId: string;
  customerId: string;
  staffId: string;
  serviceId?: string | null;
  price: number;
  description?: string;
  commission: number;
  performedAt: string;
  customerName?: string;
  serviceName?: string;
  staffName?: string;
  isCustomService?: boolean;
  productUsages?: ProductUsage[];
  correctedAt?: string | null;
  correctedBy?: string | null;
  correctedByName?: string | null;
  voidedAt?: string | null;
  voidedBy?: string | null;
  voidedByName?: string | null;
  voidReason?: string | null;
};

export type CustomerOrder = {
  id: string;
  tenantId: string;
  customerId: string;
  customerName: string;
  customerPhone: string;
  serviceId: string;
  serviceName: string;
  quotedPrice: number;
  requestedStaffId?: string | null;
  requestedStaffName?: string | null;
  notes?: string;
  status: CustomerOrderStatus;
  requestedAt: string;
  statusUpdatedAt?: string | null;
  approvedAt?: string | null;
  approvedRecordId?: string | null;
  approvedByName?: string | null;
};

export type Expense = {
  id: string;
  tenantId: string;
  category: string;
  description?: string;
  amount: number;
  expenseDate: string;
};

export type Subscription = {
  id: string;
  tenantId: string;
  packageId?: string | null;
  planCode: string;
  packageName?: string | null;
  packageDescription?: string | null;
  packageFeatures?: string[];
  billingPeriod?: BillingPeriod;
  includesMarketplace?: boolean;
  includesCustomerMarketplace?: boolean;
  status: SubscriptionStatus;
  startsAt: string;
  endsAt: string;
  graceEndsAt?: string | null;
  amount: number;
  currencyCode: string;
  autoRenew: boolean;
  paymentTerms?: string;
};

export type SubscriptionPackage = {
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
};

export type SmsLog = {
  id: string;
  tenantId: string;
  customerId?: string;
  smsType: SmsKind;
  recipientPhone: string;
  message: string;
  status: SmsStatus;
  sentAt?: string | null;
};

export type CommissionPayout = {
  id: string;
  tenantId: string;
  staffId: string;
  amount: number;
  periodStart: string;
  periodEnd: string;
  paidAt?: string | null;
};

export type StaffPerformance = {
  staffId: string;
  staffName: string;
  totalServices: number;
  totalRevenue: number;
  totalCommission: number;
  clientCount: number;
};

export type FinancialRow = {
  period: string;
  income: number;
  expenses: number;
  commissionsPaid: number;
  productCosts: number;
  netProfit: number;
};

export type StaffMetrics = {
  todayClients: number;
  monthClients: number;
  todaySales: number;
  monthSales: number;
  todayCommission: number;
  monthCommission: number;
};

export type MonthlyContributionPoint = {
  monthKey: string;
  monthLabel: string;
  revenue: number;
  commission: number;
  services: number;
  clients: number;
};

export type DashboardSummary = {
  todayRevenue: number;
  monthRevenue: number;
  monthExpenses: number;
  monthCommissionAccrued: number;
  monthCommissionPaid: number;
  monthProductCosts: number;
  monthNetProfit: number;
  currentMonthLabel: string;
  previousMonthLabel: string;
  previousMonthRevenue: number;
  previousMonthCommissionAccrued: number;
  lifetimeRevenue: number;
  lifetimeCommission: number;
  highestEarner: StaffPerformance | null;
  monthlyTrend: MonthlyContributionPoint[];
  topStaff: StaffPerformance[];
  recentServices: ServiceRecord[];
};

export type ReportMonthOption = {
  monthKey: string;
  monthLabel: string;
};

export type MonthlyReport = {
  monthKey: string;
  monthLabel: string;
  previousMonthKey: string | null;
  nextMonthKey: string | null;
  availableMonths: ReportMonthOption[];
  topCustomerByVisits: {
    customer: Customer;
    visits: number;
    spent: number;
  } | null;
  topCustomerBySpend: {
    customer: Customer;
    visits: number;
    spent: number;
  } | null;
  staffRanking: StaffPerformance[];
  totalExpenses: number;
  totalRevenue: number;
  totalCommissions: number;
  totalProductCosts: number;
  topProducts: Array<{
    productName: string;
    usageCount: number;
    totalCost: number;
  }>;
  remarks: string[];
  headaches: string[];
  improvements: string[];
};

export type MarketplaceAd = {
  id: string;
  tenantId: string;
  tenantName: string;
  tenantSlug: string;
  tenantLogoUrl?: string | null;
  title: string;
  body: string;
  contactName: string;
  contactPhone: string;
  imageUrl?: string | null;
  status: MarketplaceAdStatus;
  approvalNotes?: string | null;
  createdAt: string;
  approvedAt?: string | null;
  createdByName?: string | null;
  approvedByName?: string | null;
  isOwnAd?: boolean;
};

export type AppSession = {
  sessionId: string;
  user: User;
  tenant: Tenant | null;
  subscription: Subscription | null;
};

export type CustomerAppSession = {
  sessionId: string;
  customer: Customer;
  tenant: Tenant;
  subscription: Subscription | null;
};
