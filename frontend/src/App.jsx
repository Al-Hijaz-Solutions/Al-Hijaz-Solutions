import React, { useState, useEffect } from 'react';
import axios from 'axios';
import {
  LogOut, Filter, Printer, HelpCircle, FileText,
  CreditCard, Settings,
  ChevronRight, ChevronLeft, Activity, Globe, Download,
  User, Building, ShieldCheck, X, Eye
} from 'lucide-react';

const PAGE_SIZE = 50;
import './App.css';

const API_BASE = import.meta.env.VITE_API_BASE || '';

// Avoid ngrok interstitial blocking API responses (e.g. auth-status after OAuth redirect)
if (API_BASE && API_BASE.includes('ngrok')) {
  axios.defaults.headers.common['ngrok-skip-browser-warning'] = 'true';
}

function App() {
  const [activeTab, setActiveTab] = useState('Invoice');
  const [data, setData] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [isAuthorized, setIsAuthorized] = useState(false);
  const [accessCode, setAccessCode] = useState('');
  const [accessError, setAccessError] = useState(false);
  const [serverTotalCount, setServerTotalCount] = useState(0);

  const [filters, setFilters] = useState({
    reference: '',
    customer: '',
    customerId: '',
    dateFrom: '',
    dateTo: ''
  });

  // NEW: Preview State
  const [showPreview, setShowPreview] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [selectedItem, setSelectedItem] = useState(null);
  const [sellerData, setSellerData] = useState(null);
  const [buyerData, setBuyerData] = useState(null);
  // Credit Note submit: show same preview with Reference Invoice Number + Instruction Note inputs
  const [creditNoteSubmitMode, setCreditNoteSubmitMode] = useState(false);
  const [invoiceDocumentReference, setInvoiceDocumentReference] = useState('');
  const [instructionNote, setInstructionNote] = useState('');

  // ZATCA Result Modal
  const [showZatcaResult, setShowZatcaResult] = useState(false);
  const [zatcaResult, setZatcaResult] = useState(null);

  const [notification, setNotification] = useState(null);

  const [currentPage, setCurrentPage] = useState(1);
  const [customerPage, setCustomerPage] = useState(1);
  const [customersLoading, setCustomersLoading] = useState(false);
  const [zatcaStatusMap, setZatcaStatusMap] = useState({});
  // Which tab the current `data` belongs to - prevents showing Invoice data on Credit Note tab (and vice versa)
  const [dataTab, setDataTab] = useState(null);

  useEffect(() => {
    checkAuthStatus();
  }, []);

  useEffect(() => {
    if (!notification) return;
    const t = setTimeout(() => setNotification(null), 4000);
    return () => clearTimeout(t);
  }, [notification]);

  useEffect(() => {
    setFilters({
      reference: '',
      customer: '',
      customerId: '',
      dateFrom: '',
      dateTo: ''
    });
    setCurrentPage(1);
    setCustomerPage(1);
    // Clear table data immediately on tab switch so we never show the wrong document type
    setData([]);
    if (isAuthorized) {
      fetchCustomers();
      if (activeTab !== 'Customer') fetchData();
    }
  }, [activeTab, isAuthorized]);

  useEffect(() => {
    if (isAuthorized && filters.customerId && activeTab !== 'Customer') {
      setCurrentPage(1); // Reset to first page when customer changes
      fetchData(1);
    }
  }, [filters.customerId]);

  useEffect(() => {
    if (isAuthorized && filters.customerId && activeTab !== 'Customer') {
      fetchData(currentPage);
    }
  }, [currentPage]);

  const checkAuthStatus = async () => {
    const hasAuthSuccess = typeof window !== 'undefined' && window.location.search.includes('auth=success');
    const maxAttempts = hasAuthSuccess ? 4 : 1;
    const delayMs = 500;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const resp = await axios.get(`${API_BASE}/auth-status`);
        const authorized = resp.data?.authorized === true;
        setIsAuthorized(authorized);
        if (authorized) {
          if (hasAuthSuccess) {
            window.history.replaceState({}, '', `${window.location.origin}/`);
          }
          setInitialLoading(false);
          return;
        }
        if (!hasAuthSuccess && window.location.search) {
          window.history.replaceState({}, '', `${window.location.origin}/`);
        }
      } catch (err) {
        console.error('Auth status check failed', attempt, err);
        if (!hasAuthSuccess) {
          setIsAuthorized(false);
          if (window.location.search) {
            window.history.replaceState({}, '', `${window.location.origin}/`);
          }
          setInitialLoading(false);
          return;
        }
      }
      if (hasAuthSuccess && attempt < maxAttempts) {
        await new Promise((r) => setTimeout(r, delayMs));
      }
    }

    setIsAuthorized(false);
    if (window.location.search) {
      window.history.replaceState({}, '', `${window.location.origin}/`);
    }
    setInitialLoading(false);
  };

  const fetchCustomers = async () => {
    setCustomersLoading(true);
    try {
      const resp = await axios.get(`${API_BASE}/api/qbo/customers`);
      const customerList = resp.data.QueryResponse?.Customer || [];
      setCustomers(customerList);
    } catch (err) {
      console.error('Failed to fetch customers', err);
    } finally {
      setCustomersLoading(false);
    }
  };

  const fetchData = async (pageOverride) => {
    const tabForThisFetch = activeTab;
    const pageToFetch = pageOverride || currentPage;
    setLoading(true);
    let endpoint = '/api/qbo/invoices';
    if (tabForThisFetch === 'Credit Note') endpoint = '/api/qbo/creditmemo';

    if (!filters.customerId) {
        setData([]);
        setZatcaStatusMap({});
        setLoading(false);
        return;
    }

    try {
      const resp = await axios.get(`${API_BASE}${endpoint}?customerId=${filters.customerId}&page=${pageToFetch}`);
      let list = [];
      const qr = resp.data.QueryResponse || {};
      if (tabForThisFetch === activeTab) {
        setServerTotalCount(qr.totalCount || 0);
      }
      if (!resp.data.QueryResponse) console.warn('QBO Response missing QueryResponse:', resp.data);
      if (tabForThisFetch === 'Invoice') list = qr.Invoice || [];
      else if (tabForThisFetch === 'Credit Note') list = qr.CreditMemo || [];

      // Only apply result if user is still on the same tab (avoids race when switching tabs quickly)
      if (tabForThisFetch === activeTab) {
        setData(list);
        setDataTab(tabForThisFetch);
      }
      if (list.length > 0 && tabForThisFetch === activeTab) {
        const docNumbers = list.map(i => i.DocNumber).filter(Boolean);
        try {
          const statusResp = await axios.post(`${API_BASE}/api/zatca/status`, { invoiceNumbers: docNumbers });
          setZatcaStatusMap(statusResp.data || {});
        } catch (_) {
          setZatcaStatusMap({});
        }
      } else if (tabForThisFetch === activeTab) {
        setZatcaStatusMap({});
      }
    } catch (err) {
      console.error('Data fetch failed', err);
      if (tabForThisFetch === activeTab) setZatcaStatusMap({});
    } finally {
      setLoading(false);
    }
  };



  // Enhanced helper to extract ZATCA address components
  const parseDetailedAddress = (addr) => {
    const fullText = `${addr?.Line1 || ''} ${addr?.Line2 || ''} ${addr?.Line3 || ''}`;

    // 1. Extract 4-digit Building Number
    const buildingMatch = fullText.match(/Building\s*#?\s*(\d{4})/i) || fullText.match(/\b\d{4}\b/);
    const building = buildingMatch ? buildingMatch[1] || buildingMatch[0] : '0000';

    // 2. Extract 4-digit Additional Number
    const additionalMatch = fullText.match(/Additional\s*Number\s*#?\s*(\d{4})/i);
    const additional = additionalMatch ? additionalMatch[1] : '';

    // 3. Extract District (Neighborhood)
    const districtMatch = fullText.match(/([a-zA-Z\s]+)\s+(District|Dist|حي)/i);
    const district = districtMatch ? districtMatch[0].trim() : '';

    // 4. Street Name
    let street = (addr?.Line1 || '').split(',')[0].replace(building, '').replace(/Building\s*#?/i, '').trim();
    if (!street || street === ',') street = '---';

    return { building, additional, district, street };
  };

  const loadPreviewDataForItem = async (item) => {
    const sellerResp = await axios.get(`${API_BASE}/api/qbo/supplier-info`);
    const s = sellerResp.data || {};
    setSellerData({ name: s.name || '---', vat: s.vat || '---', building: s.building || '---', street: s.street || '---', city: s.city || '---', postal: s.postal || '---' });
    const buyerResp = await axios.get(`${API_BASE}/api/qbo/customer/${item.CustomerRef?.value}`);
    const bData = buyerResp.data?.Customer;

    let buyerVat = bData?.PrimaryTaxIdentifier || bData?.TaxRegistrationNumber || bData?.BusinessNumber || '';
    let streetName = '';
    let buildingNumber = '';
    let citySubdivisionName = '';

    if (bData?.CustomField) {
      const vatField = bData.CustomField.find(f => f.Name && (f.Name === 'Buyer VAT' || f.Name.toLowerCase().includes('vat') || f.Name.toLowerCase().includes('tax')));
      if (vatField && (vatField.StringValue || vatField.NumberValue)) buyerVat = String(vatField.StringValue || vatField.NumberValue);

      const fetchField = (nameMatch) => {
        const field = bData.CustomField.find(f => f.Name && f.Name.toLowerCase() === nameMatch.toLowerCase());
        return field ? (field.StringValue || field.NumberValue || '') : '';
      };
      streetName = fetchField('StreetName');
      buildingNumber = fetchField('BuildingNumber');
      citySubdivisionName = fetchField('CitySubdivisionName');
    }

    if ((!buyerVat || buyerVat.includes('X')) && bData?.Notes) { const m = bData.Notes.match(/\b\d{15}\b/); if (m) buyerVat = m[0]; }

    if (!streetName || !buildingNumber || !citySubdivisionName) {
      throw new Error('Please add the customer’s address details in the Custom Fields section Street Name, Building Number, City Subdivision Name, Buyer VAT');
    }

    setBuyerData({ name: bData?.DisplayName, vat: buyerVat, building: buildingNumber, additional: '', district: citySubdivisionName, street: streetName, city: bData?.BillAddr?.City, postal: bData?.BillAddr?.PostalCode });
  };

  const handlePreview = async (item) => {
    setCreditNoteSubmitMode(false);
    setInvoiceDocumentReference('');
    setInstructionNote('');
    setSelectedItem(item);
    setShowPreview(true);
    setPreviewLoading(true);
    try {
      await loadPreviewDataForItem(item);
    } catch (err) {
      console.error('Preview fetch failed', err);
      setShowPreview(false);
      setNotification({ type: 'error', message: err.response?.data?.message || err.message });
    } finally {
      setPreviewLoading(false);
    }
  };

  const handleSendToZatcaClick = (item) => {
    // On Credit Note tab always show popup (reference + reason). No bypass: avoids accidentally
    // submitting an invoice if data ever shows in the wrong tab.
    if (activeTab === 'Credit Note') {
      setCreditNoteSubmitMode(true);
      setInvoiceDocumentReference('');
      setInstructionNote('');
      setSelectedItem(item);
      setShowPreview(true);
      setPreviewLoading(true);
      loadPreviewDataForItem(item)
        .catch((err) => {
          setShowPreview(false);
          setNotification({ type: 'error', message: err.response?.data?.message || err.message });
        })
        .finally(() => setPreviewLoading(false));
    } else {
      handleZatcaSubmit(item);
    }
  };

  const handleZatcaSubmit = async (item) => {
    try {
      setLoading(true);
      const resp = await axios.post(`${API_BASE}/api/zatca/submit`, {
        invoiceId: item.Id,
        invoiceNumber: item.DocNumber,
        invoiceData: item
      });

      setZatcaResult({
        success: resp.data.success,
        status: resp.data.status,
        zatcaStatus: resp.data.zatcaStatus,
        message: resp.data.message,
        zatcaResponse: resp.data.zatcaResponse || null,
        invoiceNumber: item.DocNumber,
        savedPath: resp.data.savedPath
      });
      setShowZatcaResult(true);
      if (resp.data.success && resp.data.status === 'CLEARED') {
        setZatcaStatusMap(prev => ({ ...prev, [item.DocNumber]: 'CLEARED' }));
      }
      fetchData();
    } catch (err) {
      const resp = err.response?.data;
      if (resp?.status === 'CLEARED') {
        setZatcaStatusMap(prev => ({ ...prev, [item?.DocNumber]: 'CLEARED' }));
        fetchData();
      }
      setNotification({ type: 'error', message: resp?.message || err.message || 'ZATCA submission failed.' });
      setZatcaResult({
        success: false,
        status: resp?.status || 'ERROR',
        zatcaStatus: resp?.zatcaStatus,
        message: resp?.message || err.message || 'ZATCA submission failed.',
        zatcaResponse: resp?.zatcaResponse || null,
        invoiceNumber: item?.DocNumber
      });
      setShowZatcaResult(true);
    } finally {
      setLoading(false);
    }
  };

  // Only use table data when it belongs to the current tab - prevents showing Invoice rows on Credit Note tab
  const safeData = dataTab === activeTab ? data : [];
  const filteredData = safeData.filter(item => {
    const matchRef = filters.reference ? (item.DocNumber || '').toLowerCase().includes(filters.reference.toLowerCase()) : true;
    const matchCust = filters.customerId ? item.CustomerRef?.value === filters.customerId : true;
    const matchDateFrom = filters.dateFrom ? (item.TxnDate || '') >= filters.dateFrom : true;
    const matchDateTo = filters.dateTo ? (item.TxnDate || '') <= filters.dateTo : true;
    return matchRef && matchCust && matchDateFrom && matchDateTo;
  });

  const totalPages = activeTab === 'Customer' 
    ? Math.max(1, Math.ceil(sortedCustomers.length / PAGE_SIZE))
    : Math.max(1, Math.ceil(serverTotalCount / PAGE_SIZE));

  const paginatedData = activeTab === 'Customer' 
    ? filteredData.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE)
    : filteredData; // Backend already paginated

  const sortedCustomers = [...customers].sort((a, b) => (a.DisplayName || '').localeCompare(b.DisplayName || ''));
  const customerTotalPages = Math.max(1, Math.ceil(sortedCustomers.length / PAGE_SIZE));
  const paginatedCustomers = sortedCustomers.slice((customerPage - 1) * PAGE_SIZE, customerPage * PAGE_SIZE);

  useEffect(() => {
    setCurrentPage(1);
  }, [filters.reference, filters.customer, filters.dateFrom, filters.dateTo]);

  useEffect(() => {
    if (currentPage > totalPages) setCurrentPage(Math.max(1, totalPages));
  }, [totalPages]);

  const handleConnect = async () => {
    setAccessError(false);
    if (!accessCode) {
      setAccessError(true);
      return;
    }
    
    try {
      await axios.post(`${API_BASE}/verify-access`, { accessCode });
      window.location.href = `${API_BASE}/auth?accessCode=${encodeURIComponent(accessCode)}`;
    } catch (err) {
      setAccessError(true);
    }
  };

  const handleSignOut = async () => {
    try {
      await axios.get(`${API_BASE}/signout`);
      setIsAuthorized(false);
      setData([]);
      setDataTab(null);
      window.history.replaceState({}, '', `${window.location.origin}/`);
    } catch (err) {
      console.error('Sign out failed', err);
      setIsAuthorized(false);
      window.history.replaceState({}, '', `${window.location.origin}/`);
    }
  };

  if (initialLoading) {
    return (
      <div className="login-screen">
        <div style={{ color: 'white', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '20px' }}>
          <Activity className="status-dot" style={{ width: 48, height: 48 }} />
          <p>Verifying Production Session...</p>
        </div>
      </div>
    );
  }

  if (!isAuthorized) {
    return (
      <div className="login-screen">
        <div className="login-card">
          <div className="login-logo-icon">Q</div>
          <h2 style={{ fontWeight: 800, color: '#022c22', marginBottom: '8px' }}>QUICK QRO</h2>
          <p style={{ color: '#64748b', fontSize: '15px', marginBottom: '24px' }}>ZATCA / QuickBooks Online Connector</p>
          
          <div style={{ width: '100%', marginBottom: '16px' }}>
            {accessError && (
              <div style={{ color: '#dc2626', fontSize: '13px', marginBottom: '8px', fontWeight: 600 }}>
                Invalid or missing access code. Please try again.
              </div>
            )}
            <input 
              type="password" 
              placeholder="Enter Access Code" 
              value={accessCode}
              onChange={(e) => {
                setAccessCode(e.target.value);
                if (accessError) setAccessError(false);
              }}
              style={{ 
                width: '100%', 
                padding: '12px', 
                borderRadius: '8px', 
                border: `1px solid ${accessError ? '#dc2626' : '#cbd5e1'}`, 
                fontSize: '14px', 
                textAlign: 'center',
                outline: accessError ? 'none' : undefined,
                boxShadow: accessError ? '0 0 0 1px #dc2626' : 'none'
              }}
            />
          </div>

          <button onClick={handleConnect} className="btn-connect">
            Connect Securely
          </button>
          <p style={{ marginTop: '24px', fontSize: '12px', color: '#94a3b8' }}>
            Protected by Intuit OAuth 2.0 Security
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="desktop-container">
      {notification && (
        <div
          style={{
            position: 'fixed',
            top: 16,
            left: '50%',
            transform: 'translateX(-50%)',
            padding: '12px 24px',
            borderRadius: 8,
            background: notification.type === 'success' ? '#10b981' : '#dc2626',
            color: 'white',
            fontWeight: 600,
            zIndex: 9999,
            boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
          }}
        >
          {notification.message}
        </div>
      )}
      <header>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <Globe size={18} />
          <span>ZATCA QUICKBOOKS ONLINE</span>
        </div>
        <div className="header-status">
          <div className="status-dot" style={{ backgroundColor: '#10b981' }}></div>
          CONNECTED TO PRODUCTION
        </div>
      </header>

      <div className="main-layout">
        <div className="sidebar">
          <div className="logo-section">
            <div className="logo-container">
              <div className="logo-icon">Q</div>
              <div>
                <div className="logo-text-main">Quick QRO</div>
                <div className="logo-text-sub">PDT Solutions</div>
              </div>
            </div>
          </div>

          <nav className="nav-menu">
            {[
              { id: 'Invoice', icon: <FileText size={18} /> },
              { id: 'Credit Note', icon: <CreditCard size={18} /> },
              { id: 'Customer', icon: <User size={18} /> },
              { id: 'About', icon: <HelpCircle size={18} /> }
            ].map(item => (
              <div
                key={item.id}
                className={`nav-item ${activeTab === item.id ? 'active' : ''}`}
                onClick={() => setActiveTab(item.id)}
              >
                {item.icon}
                <span>{item.id}</span>
              </div>
            ))}
          </nav>

          <div className="sidebar-footer">
            <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', marginBottom: 8, fontWeight: 700 }}>CURRENT SESSION</div>
            <select className="company-switcher">
              <option>kashifaltaf267@gmail.com</option>
            </select>
            <button className="btn-signout" onClick={handleSignOut}>
              <LogOut size={16} /> Sign Out
            </button>
          </div>
        </div>

        <div className="content-area">
          <div className="view-header">
            <div style={{ color: '#10b981', fontSize: 12, fontWeight: 700, marginBottom: 4 }}>DASHBOARD / {activeTab.toUpperCase()}</div>
            <h1 className="view-title">{activeTab === 'About' ? 'About Quick QRO' : activeTab + 's'}</h1>
          </div>

          {activeTab === 'About' ? (
            <div className="filter-card" style={{ lineHeight: '1.6', color: '#1e293b' }}>
              <h3 style={{ marginBottom: '16px', color: '#064e3b' }}>Electronic Invoicing Solution</h3>
              <p style={{ marginBottom: '12px' }}>
                <b>Quick QRO</b> is a premium connector designed to bridge <b>QuickBooks Online</b> with <b>ZATCA (Fatoora)</b> compliance requirements in Saudi Arabia.
              </p>
              <p style={{ marginBottom: '12px' }}>
                This application automates the retrieval of financial documents including Invoices, Credit Notes, and Sales Receipts, providing a streamlined interface for monitoring compliance status and generating required reports.
              </p>
              <div style={{ marginTop: '24px', padding: '16px', background: '#f8fafc', borderRadius: '12px', border: '1px solid #e2e8f0' }}>
                <h4 style={{ fontSize: '14px', marginBottom: '8px', color: '#064e3b' }}>Version Information</h4>
                <div style={{ fontSize: '13px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <div>Core Engine: v1.2.4</div>
                  <div>ZATCA Integration: Phase 2 Ready</div>
                  <div>Last Updated: February 2026</div>
                </div>
              </div>
              <p style={{ marginTop: '24px', fontSize: '12px', color: '#64748b' }}>
                Developed by PDT Solutions. For support, contact <a href="mailto:kashifaltaf267@gmail.com" style={{ color: '#10b981' }}>kashifaltaf267@gmail.com</a>
              </p>
            </div>
          ) : activeTab === 'Customer' ? (
            <div className="table-card">
              {customersLoading ? (
                <div style={{ padding: '60px', textAlign: 'center' }}>
                  <Activity className="status-dot" style={{ width: 32, height: 32, margin: '0 auto 16px' }} />
                  <div style={{ color: '#64748b' }}>Retrieving customer list...</div>
                </div>
              ) : (
                <>
                  <div className="table-wrapper">
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>Name</th>
                          <th>Email</th>
                          <th>Phone</th>
                          <th>Balance</th>
                          <th>Company</th>
                          <th>Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {paginatedCustomers.length > 0 ? paginatedCustomers.map(c => (
                          <tr key={c.Id}>
                            <td style={{ fontWeight: 600 }}>{c.DisplayName || '—'}</td>
                            <td>{c.PrimaryEmailAddr?.Address || '—'}</td>
                            <td>{c.PrimaryPhone?.FreeFormNumber || c.PrimaryPhone?.Digit || '—'}</td>
                            <td style={{ fontWeight: 600 }}>{c.Balance != null ? parseFloat(c.Balance).toLocaleString() : '—'}</td>
                            <td>{c.CompanyName || '—'}</td>
                            <td>
                              <span className={`status-badge ${c.Active === false ? 'status-pending' : 'status-success'}`}>
                                {c.Active === false ? 'Inactive' : 'Active'}
                              </span>
                            </td>
                          </tr>
                        )) : (
                          <tr>
                            <td colSpan="6" style={{ textAlign: 'center', padding: '80px', color: '#94a3b8' }}>
                              <User size={48} style={{ margin: '0 auto 16px', opacity: 0.1 }} />
                              <div>No customers found.</div>
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                  {sortedCustomers.length > 0 && (
                    <div className="table-pagination">
                      <div style={{ fontSize: '13px', color: '#64748b' }}>
                        Showing {(customerPage - 1) * PAGE_SIZE + 1}–{Math.min(customerPage * PAGE_SIZE, sortedCustomers.length)} of {sortedCustomers.length} customers
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <button
                          className="btn-outline"
                          style={{ padding: '6px 12px' }}
                          disabled={customerPage <= 1}
                          onClick={() => setCustomerPage(p => Math.max(1, p - 1))}
                        >
                          <ChevronLeft size={16} /> Previous
                        </button>
                        <span style={{ fontSize: '13px', color: '#475569' }}>
                          Page {customerPage} of {customerTotalPages}
                        </span>
                        <button
                          className="btn-outline"
                          style={{ padding: '6px 12px' }}
                          disabled={customerPage >= customerTotalPages}
                          onClick={() => setCustomerPage(p => Math.min(customerTotalPages, p + 1))}
                        >
                          Next <ChevronRight size={16} />
                        </button>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          ) : (
            <>
              <div className="filter-card">
                <div className="filter-grid">
                  <div className="filter-group">
                    <label>Reference Number</label>
                    <input
                      type="text"
                      value={filters.reference}
                      onChange={(e) => setFilters({ ...filters, reference: e.target.value })}
                      placeholder="e.g. INV-1001"
                    />
                  </div>
                  <div className="filter-group">
                    <label>Customer Name</label>
                    <select
                      value={filters.customerId}
                      onChange={(e) => {
                          const selectedOpt = e.target.options[e.target.selectedIndex];
                          setFilters({ ...filters, customerId: e.target.value, customer: selectedOpt.text });
                      }}
                    >
                      <option value="">Select a Customer</option>
                      {[...customers]
                        .sort((a, b) => (a.DisplayName || '').localeCompare(b.DisplayName || ''))
                        .map(c => (
                          <option key={c.Id} value={c.Id}>{c.DisplayName}</option>
                        ))}
                    </select>
                  </div>
                  <div className="filter-group">
                    <label>Date Range (From)</label>
                    <input type="date" value={filters.dateFrom} onChange={(e) => setFilters({ ...filters, dateFrom: e.target.value })} />
                  </div>
                  <div className="filter-group">
                    <label>Date Range (To)</label>
                    <input type="date" value={filters.dateTo} onChange={(e) => setFilters({ ...filters, dateTo: e.target.value })} />
                  </div>
                </div>

                <div className="action-bar">
                  <button className="btn-outline"><Printer size={16} /> Print Report</button>
                  <button className="btn-primary" onClick={fetchData}><Filter size={16} /> Apply Filters</button>
                </div>
              </div>

              <div className="table-card">
                {loading ? (
                  <div style={{ padding: '60px', textAlign: 'center' }}>
                    <Activity className="status-dot" style={{ width: 32, height: 32, margin: '0 auto 16px' }} />
                    <div style={{ color: '#64748b' }}>Retrieving document list...</div>
                  </div>
                ) : (
                  <div className="table-wrapper">
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th style={{ width: 30 }}><input type="checkbox" /></th>
                          <th>Ref Number</th>
                          <th>Customer</th>
                          <th>Date</th>
                          <th>Currency</th>
                          <th>Total Amount</th>
                          <th>Zatca Status</th>
                          <th>Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {paginatedData.length > 0 ? paginatedData.map(item => (
                          <tr key={item.Id}>
                            <td><input type="checkbox" /></td>
                            <td style={{ fontWeight: 600 }}>{item.DocNumber || '---'}</td>
                            <td>{item.CustomerRef.name}</td>
                            <td>{item.TxnDate}</td>
                            <td><span style={{ fontSize: 11, background: '#f1f5f9', padding: '2px 6px', borderRadius: '4px' }}>{item.CurrencyRef?.value || 'SAR'}</span></td>
                            <td style={{ fontWeight: 700 }}>{parseFloat(item.TotalAmt).toLocaleString()}</td>
                            <td>
                              {(() => {
                                const status = zatcaStatusMap[item.DocNumber] || 'PENDING';
                                const statusClass = status === 'CLEARED' ? 'status-success' : status === 'REJECTED' || status === 'ZATCA_REJECTED' ? 'status-rejected' : 'status-pending';
                                const statusIcon = status === 'CLEARED' ? <ShieldCheck size={10} /> : status === 'REJECTED' || status === 'ZATCA_REJECTED' ? <X size={10} /> : <Activity size={10} />;
                                return (
                                  <span className={`status-badge ${statusClass}`}>
                                    {statusIcon} {status}
                                  </span>
                                );
                              })()}
                            </td>
                            <td>
                              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                                {/* <button
                                  onClick={() => handlePreview(item)}
                                  className="btn-outline"
                                  style={{ padding: '6px 12px', fontSize: '11px' }}
                                  title="View Data for ZATCA"
                                >
                                  <Eye size={12} style={{ marginRight: 4 }} /> View Detail
                                </button> */}
                                <button
                                  onClick={() => handleSendToZatcaClick(item)}
                                  className="btn-primary"
                                  style={{ padding: '6px 12px', fontSize: '11px', background: '#065f46' }}
                                  disabled={zatcaStatusMap[item.DocNumber] === 'CLEARED'}
                                  title={zatcaStatusMap[item.DocNumber] === 'CLEARED' ? 'Already submitted to ZATCA' : undefined}
                                >
                                  <Globe size={12} style={{ marginRight: 4 }} /> Send to ZATCA
                                </button>
                                {/* <a href="#" className="action-btn" title="Download"><Download size={14} /></a> */}
                              </div>
                            </td>
                          </tr>
                        )) : (
                          <tr>
                            <td colSpan="8" style={{ textAlign: 'center', padding: '80px', color: '#94a3b8' }}>
                              <FileText size={48} style={{ margin: '0 auto 16px', opacity: 0.1 }} />
                              <div>No {activeTab.toLowerCase()}s found matching these filters.</div>
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                )}

                {/* Pagination */}
                {!loading && (activeTab === 'Customer' ? sortedCustomers.length > 0 : serverTotalCount > 0) && (
                  <div className="table-pagination">
                    <div style={{ fontSize: '13px', color: '#64748b' }}>
                      {activeTab === 'Customer' 
                        ? `Showing ${(currentPage - 1) * PAGE_SIZE + 1}–${Math.min(currentPage * PAGE_SIZE, sortedCustomers.length)} of ${sortedCustomers.length}`
                        : `Showing ${(currentPage - 1) * PAGE_SIZE + 1}–${Math.min(currentPage * PAGE_SIZE, serverTotalCount)} of ${serverTotalCount} docs`}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <button
                        className="btn-outline"
                        style={{ padding: '6px 12px' }}
                        disabled={currentPage <= 1}
                        onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                      >
                        <ChevronLeft size={16} /> Previous
                      </button>
                      <span style={{ fontSize: '13px', color: '#475569' }}>
                        Page {currentPage} of {totalPages}
                      </span>
                      <button
                        className="btn-outline"
                        style={{ padding: '6px 12px' }}
                        disabled={currentPage >= totalPages}
                        onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                      >
                        Next <ChevronRight size={16} />
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {/* ZATCA PREVIEW MODAL */}
      {showPreview && (
        <div className="modal-overlay">
          <div className="modal-content">
            <div className="modal-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <ShieldCheck className="text-emerald-600" size={24} color="#10b981" />
                <div>
                  <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 700 }}>ZATCA Submission Preview</h3>
                  <p style={{ margin: 0, fontSize: '12px', color: '#64748b' }}>Technical review of document data before signing.</p>
                </div>
              </div>
              <button onClick={() => { setShowPreview(false); setCreditNoteSubmitMode(false); setInvoiceDocumentReference(''); setInstructionNote(''); }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8' }}>
                <X size={24} />
              </button>
            </div>

            <div className="modal-body">
              {previewLoading ? (
                <div style={{ padding: '80px', textAlign: 'center' }}>
                  <Activity className="status-dot" style={{ width: 40, height: 40, margin: '0 auto 20px' }} />
                  <p style={{ color: '#64748b' }}>Merging QuickBooks Data with ZATCA Requirements...</p>
                </div>
              ) : (
                <>
                  <div className="preview-grid">
                    {/* INVOICE SECTION */}
                    <div className="preview-section">
                      <div className="preview-title"><FileText size={14} /> Document Information</div>
                      <div className="preview-field">
                        <span className="preview-label">Invoice Number</span>
                        <span className="preview-value">{selectedItem?.DocNumber || '---'}</span>
                      </div>
                      <div className="preview-field">
                        <span className="preview-label">Transaction Date</span>
                        <span className="preview-value">{selectedItem?.TxnDate}</span>
                      </div>
                      <div className="preview-field">
                        <span className="preview-label">Total Amount</span>
                        <span className="preview-value">{selectedItem?.CurrencyRef.value} {parseFloat(selectedItem?.TotalAmt).toLocaleString()}</span>
                      </div>
                      {creditNoteSubmitMode && (
                        <>
                          <div className="preview-field" style={{ marginTop: 12 }}>
                            <span className="preview-label">Reference Invoice Number (Invoice Document Reference)</span>
                            <input
                              type="text"
                              value={invoiceDocumentReference}
                              onChange={(e) => setInvoiceDocumentReference(e.target.value)}
                              placeholder="e.g. JD25001223 or SME00002"
                              style={{ width: '100%', padding: '8px 12px', borderRadius: 8, border: '1px solid #e2e8f0', fontSize: 14, marginTop: 4 }}
                            />
                          </div>
                          <div className="preview-field" style={{ marginTop: 12 }}>
                            <span className="preview-label">Instruction Note (Reason for credit note / KSA-10)</span>
                            <input
                              type="text"
                              value={instructionNote}
                              onChange={(e) => setInstructionNote(e.target.value)}
                              placeholder="e.g. In case of goods or services refund | عند ترجيع السلع أو الخدمات"
                              style={{ width: '100%', padding: '8px 12px', borderRadius: 8, border: '1px solid #e2e8f0', fontSize: 14, marginTop: 4 }}
                            />
                          </div>
                        </>
                      )}
                    </div>

                    {/* SELLER SECTION */}
                    <div className="preview-section">
                      <div className="preview-title"><Building size={14} /> Seller Info (From CompanyInfo)</div>
                      <div className="preview-field">
                        <span className="preview-label">Legal Name</span>
                        <span className="preview-value">{sellerData?.name || '---'}</span>
                      </div>
                      <div className="preview-field">
                        <span className="preview-label">Seller VAT Number</span>
                        <span className="preview-value">
                          {sellerData?.vat || '--- (Needs VAT in Settings)'}
                        </span>
                      </div>
                      <div className="preview-field">
                        <span className="preview-label">Registered Office</span>
                        <span className="preview-value" style={{ fontSize: '12px' }}>
                          {sellerData?.city}, {sellerData?.postal}
                        </span>
                      </div>
                    </div>

                    {/* BUYER SECTION */}
                    <div className="preview-section">
                      <div className="preview-title"><User size={14} /> Buyer Details (Customer Profile)</div>
                      <div className="preview-field">
                        <span className="preview-label">Customer Name</span>
                        <span className="preview-value">{buyerData?.name || '---'}</span>
                      </div>
                      <div className="preview-field">
                        <span className="preview-label">Buyer VAT Number</span>
                        <span className="preview-value">
                          {buyerData?.vat || 'Not Provided (B2C Mode)'}
                        </span>
                      </div>
                      <div className="preview-field">
                        <span className="preview-label">Delivery Address</span>
                        <span className="preview-value" style={{ fontSize: '12px' }}>
                          {buyerData?.city ? `${buyerData.city}, ${buyerData.postal}` : 'No Address Stored'}
                        </span>
                      </div>
                    </div>

                    {/* ZATCA COMPLIANCE SECTION */}
                    <div className="preview-section">
                      <div className="preview-title"><ShieldCheck size={14} /> Phase 2 Readiness Status</div>
                      <div className={`readiness-tag ${buyerData?.TaxRegistrationNumber ? 'readiness-ready' : 'readiness-warning'}`}>
                        {buyerData?.TaxRegistrationNumber ? (
                          <>Standard Tax Invoice (B2B Enabled)</>
                        ) : (
                          <>Simplified Invoice (B2B Mode Enabled)</>
                        )}
                      </div>
                      <div style={{ marginTop: '16px', fontSize: '12px', color: '#64748b' }}>
                        ✅ UBL 2.1 Schema Mapping: Ready<br />
                        ✅ Currency: {selectedItem?.CurrencyRef.value === 'SAR' ? 'Match' : 'Requires Conversion'}<br />
                        ✅ Hash Chain: Initialized
                      </div>
                    </div>
                  </div>
                </>
              )}
            </div>

            <div className="modal-footer">
              <button className="btn-outline" onClick={() => { setShowPreview(false); setCreditNoteSubmitMode(false); setInvoiceDocumentReference(''); setInstructionNote(''); }}>Cancel</button>
              {/* <button
                className="btn-outline"
                style={{ borderColor: '#10b981', color: '#065f46' }}
                onClick={async () => {
                  setPreviewLoading(true);
                  try {
                    const resp = await axios.post(`${API_BASE}/api/zatca/preview-xml`, {
                      invoiceData: selectedItem,
                      customerId: selectedItem.CustomerRef.value
                    });
                    setNotification({ message: `XML saved: ${resp.data.fileName}`, type: 'success' });
                  } catch (err) {
                    console.error('XML Generation failed', err);
                    setNotification({ message: 'Failed to generate XML', type: 'error' });
                  } finally {
                    setPreviewLoading(false);
                  }
                }}
              >
                <Download size={16} style={{ marginRight: 8 }} /> Generate & Save XML
              </button> */}
              <button
                className="btn-primary"
                disabled={previewLoading || (creditNoteSubmitMode && (!invoiceDocumentReference?.trim() || !instructionNote?.trim()))}
                onClick={async () => {
                  if (creditNoteSubmitMode) {
                    const ref = invoiceDocumentReference?.trim();
                    const note = instructionNote?.trim();
                    if (!ref || !note) return;
                    setShowPreview(false);
                    setCreditNoteSubmitMode(false);
                    setInvoiceDocumentReference('');
                    setInstructionNote('');
                    try {
                      setLoading(true);
                      const resp = await axios.post(`${API_BASE}/api/zatca/submit`, {
                        invoiceId: selectedItem?.Id,
                        invoiceNumber: selectedItem?.DocNumber,
                        invoiceData: selectedItem,
                        isCreditNote: true,
                        invoiceDocumentReference: ref,
                        instructionNote: note,
                      });
                      setZatcaResult({
                        success: resp.data.success,
                        status: resp.data.status,
                        zatcaStatus: resp.data.zatcaStatus,
                        message: resp.data.message,
                        zatcaResponse: resp.data.zatcaResponse || null,
                        invoiceNumber: selectedItem?.DocNumber,
                        savedPath: resp.data.savedPath
                      });
                      setShowZatcaResult(true);
                      if (resp.data.success && resp.data.status === 'CLEARED') {
                        setZatcaStatusMap(prev => ({ ...prev, [selectedItem?.DocNumber]: 'CLEARED' }));
                      }
                      fetchData();
                    } catch (err) {
                      const resp = err.response?.data;
                      if (resp?.status === 'CLEARED') setZatcaStatusMap(prev => ({ ...prev, [selectedItem?.DocNumber]: 'CLEARED' }));
                      setZatcaResult({
                        success: false,
                        status: resp?.status || 'ERROR',
                        zatcaStatus: resp?.zatcaStatus,
                        message: resp?.message || err.message || 'ZATCA submission failed.',
                        zatcaResponse: resp?.zatcaResponse || null,
                        invoiceNumber: selectedItem?.DocNumber
                      });
                      setShowZatcaResult(true);
                      fetchData();
                    } finally {
                      setLoading(false);
                    }
                  } else {
                    setShowPreview(false);
                    handleZatcaSubmit(selectedItem);
                  }
                }}
              >
                <Globe size={16} /> Sign & Submit to ZATCA
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ZATCA RESULT MODAL */}
      {showZatcaResult && zatcaResult && (() => {
        const isServerUnavailable = Number(zatcaResult.zatcaStatus) === 503 || Number(zatcaResult.zatcaStatus) === 502 || Number(zatcaResult.zatcaStatus) === 504;
        const failTitle = isServerUnavailable ? 'ZATCA Service Unavailable' : 'ZATCA Compliance: Failed';
        const statusLabel = isServerUnavailable
          ? `${zatcaResult.zatcaStatus || '503'} Service Temporarily Unavailable`
          : (zatcaResult.zatcaResponse?.clearanceStatus || zatcaResult.status);
        const failMessage = isServerUnavailable
          ? 'The ZATCA gateway is temporarily unavailable. Your invoice has been signed and saved locally. Please try again later.'
          : zatcaResult.message;
        return (
          <div className="modal-overlay">
            <div className="modal-content" style={{ maxWidth: '520px' }}>
              <div className="modal-header">
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  {zatcaResult.success ? (
                    <ShieldCheck size={24} color="#10b981" />
                  ) : (
                    <X size={24} color="#dc2626" />
                  )}
                  <div>
                    <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 700 }}>
                      {zatcaResult.success ? 'ZATCA Compliance: Success' : failTitle}
                    </h3>
                    <p style={{ margin: 0, fontSize: '12px', color: '#64748b' }}>
                      Invoice {zatcaResult.invoiceNumber}
                    </p>
                  </div>
                </div>
                <button onClick={() => setShowZatcaResult(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8' }}>
                  <X size={24} />
                </button>
              </div>

              <div className="modal-body">
                {/* Status Badge */}
                <div style={{ marginBottom: '16px' }}>
                  <span
                    className="status-badge"
                    style={{
                      background: zatcaResult.success ? '#d1fae5' : '#fee2e2',
                      color: zatcaResult.success ? '#065f46' : '#991b1b',
                      padding: '8px 14px',
                      borderRadius: '8px',
                      fontWeight: 700,
                      fontSize: '14px'
                    }}
                  >
                    {zatcaResult.success ? (zatcaResult.zatcaResponse?.clearanceStatus || zatcaResult.status) : statusLabel}
                  </span>
                </div>

                {/* Validation Results */}
                {zatcaResult.zatcaResponse?.validationResults && (
                  <div style={{ marginBottom: '16px' }}>
                    <div style={{ fontSize: '12px', fontWeight: 700, color: '#475569', marginBottom: '8px' }}>Validation Results</div>
                    <div style={{ background: '#f8fafc', borderRadius: '8px', padding: '12px', border: '1px solid #e2e8f0' }}>
                      <div style={{ fontSize: '13px', marginBottom: '8px' }}>
                        <strong>Status:</strong>{' '}
                        <span style={{ color: zatcaResult.zatcaResponse.validationResults.status === 'PASS' ? '#059669' : '#dc2626' }}>
                          {zatcaResult.zatcaResponse.validationResults.status}
                        </span>
                      </div>
                      {zatcaResult.zatcaResponse.validationResults.infoMessages?.length > 0 && (
                        <div style={{ fontSize: '12px', marginTop: '8px' }}>
                          <div style={{ fontWeight: 600, marginBottom: '4px' }}>Info</div>
                          {zatcaResult.zatcaResponse.validationResults.infoMessages.map((m, i) => (
                            <div key={i} style={{ padding: '6px 0', borderBottom: i < zatcaResult.zatcaResponse.validationResults.infoMessages.length - 1 ? '1px solid #e2e8f0' : 'none' }}>
                              <span style={{ color: '#059669' }}>{m.code}</span>: {m.message}
                            </div>
                          ))}
                        </div>
                      )}
                      {zatcaResult.zatcaResponse.validationResults.warningMessages?.length > 0 && (
                        <div style={{ fontSize: '12px', marginTop: '8px', color: '#b45309' }}>
                          <div style={{ fontWeight: 600, marginBottom: '4px' }}>Warnings</div>
                          {zatcaResult.zatcaResponse.validationResults.warningMessages.map((m, i) => (
                            <div key={i}>{m.message}</div>
                          ))}
                        </div>
                      )}
                      {zatcaResult.zatcaResponse.validationResults.errorMessages?.length > 0 && (
                        <div style={{ fontSize: '12px', marginTop: '8px', color: '#dc2626' }}>
                          <div style={{ fontWeight: 600, marginBottom: '4px' }}>Errors</div>
                          {zatcaResult.zatcaResponse.validationResults.errorMessages.map((m, i) => (
                            <div key={i}>{m.message}</div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {(zatcaResult.success ? zatcaResult.message : failMessage) && (
                  <p style={{ fontSize: '13px', color: '#64748b', margin: 0 }}>
                    {zatcaResult.success ? zatcaResult.message : failMessage}
                  </p>
                )}
              </div>

              <div className="modal-footer">
                <button className="btn-primary" onClick={() => setShowZatcaResult(false)}>Close</button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}

export default App;
