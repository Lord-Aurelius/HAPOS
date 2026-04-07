'use client';

import { startTransition, useDeferredValue, useState } from 'react';

import { formatCurrency } from '@/lib/format';
import type { Customer, Service, User } from '@/lib/types';

type ServiceEntryFormProps = {
  customers: Customer[];
  services: Service[];
  staff: User[];
  currencyCode: string;
};

export function ServiceEntryForm({
  customers,
  services,
  staff,
  currencyCode,
}: ServiceEntryFormProps) {
  const [phoneQuery, setPhoneQuery] = useState('');
  const [selectedServiceId, setSelectedServiceId] = useState(services[0]?.id ?? '');
  const [selectedStaffId, setSelectedStaffId] = useState(staff[0]?.id ?? '');
  const [notes, setNotes] = useState('');
  const deferredPhoneQuery = useDeferredValue(phoneQuery);

  const matchingCustomers = customers.filter((customer) => {
    const term = deferredPhoneQuery.trim();
    if (!term) {
      return true;
    }

    return customer.phone.includes(term) || customer.phoneE164.includes(term) || customer.name.toLowerCase().includes(term.toLowerCase());
  });

  const selectedService = services.find((service) => service.id === selectedServiceId) ?? services[0];
  const selectedStaff = staff.find((member) => member.id === selectedStaffId) ?? staff[0];

  const commission =
    selectedService?.commissionType === 'fixed'
      ? selectedService.commissionValue
      : Math.round((selectedService.price * selectedService.commissionValue) / 100);

  return (
    <div className="service-entry-grid">
      <section className="panel">
        <div className="panel-header">
          <div>
            <h2>Record completed service</h2>
            <p className="panel-copy">
              Built for a sub-10-second counter flow: find the customer, tap the service, save, and queue the thank-you SMS.
            </p>
          </div>
          <span className="pill">Fast entry</span>
        </div>

        <div className="field-grid">
          <div className="field">
            <label htmlFor="phoneSearch">Customer phone</label>
            <input
              id="phoneSearch"
              placeholder="Search by phone or name"
              value={phoneQuery}
              onChange={(event) => {
                startTransition(() => setPhoneQuery(event.target.value));
              }}
            />
          </div>

          <div className="field">
            <label>Price list</label>
            <div className="service-picker">
              {services.map((service) => (
                <button
                  key={service.id}
                  type="button"
                  className="service-choice"
                  data-active={service.id === selectedServiceId}
                  onClick={() => setSelectedServiceId(service.id)}
                >
                  <strong>{service.name}</strong>
                  <span>{formatCurrency(service.price, currencyCode)}</span>
                  <span>{service.description}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="field">
            <label htmlFor="staffId">Staff member</label>
            <select id="staffId" value={selectedStaffId} onChange={(event) => setSelectedStaffId(event.target.value)}>
              {staff.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.fullName}
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            <label htmlFor="notes">Description / notes</label>
            <textarea
              id="notes"
              placeholder="Beard line-up, medium knotless refresh, low fade..."
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
            />
          </div>

          <div className="hero-actions">
            <button type="button" className="button">
              Save &amp; Queue Thank You
            </button>
            <button type="button" className="button secondary">
              Save Only
            </button>
          </div>
        </div>
      </section>

      <section className="panel stack">
        <div>
          <h3>Selected service</h3>
          <p className="panel-copy">Staff must choose from predefined tenant services so pricing stays controlled.</p>
        </div>

        <div className="list-row">
          <div>
            <strong>{selectedService?.name}</strong>
            <div className="eyebrow">{selectedStaff?.fullName}</div>
          </div>
          <strong>{selectedService ? formatCurrency(selectedService.price, currencyCode) : '-'}</strong>
        </div>

        <div className="list-row">
          <div>
            <strong>Commission snapshot</strong>
            <div className="eyebrow">
              {selectedService?.commissionType === 'fixed'
                ? 'Fixed payout'
                : `${selectedService?.commissionValue ?? 0}% of service price`}
            </div>
          </div>
          <strong>{formatCurrency(commission, currencyCode)}</strong>
        </div>

        <div>
          <h4>Customer matches</h4>
          <p className="note">If there is no match, the UI should offer an inline customer create flow using the typed phone number.</p>
        </div>

        <div className="stack">
          {matchingCustomers.slice(0, 4).map((customer) => (
            <div key={customer.id} className="list-row">
              <div>
                <strong>{customer.name}</strong>
                <div className="eyebrow">{customer.phoneE164}</div>
              </div>
              <div className="eyebrow">{customer.totalVisits ?? 0} visits</div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
