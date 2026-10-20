import { STATES } from "./constants";

export default function AddressFields(props) {
  const {
    street,
    setStreet,
    city,
    setCity,
    stateCode,
    setStateCode,
    zip,
    setZip,
    fieldErrors = {},
  } = props;

  return (
    <>
      <label htmlFor="street">Street Address</label>
      <input
        id="street"
        name="street"
        type="text"
        value={street}
        onChange={(e) => setStreet(e.target.value)}
        placeholder="123 Main St"
        autoComplete="address-line1"
        required
      />

      <label htmlFor="city">City</label>
      <input
        id="city"
        name="city"
        type="text"
        value={city}
        onChange={(e) => setCity(e.target.value)}
        placeholder="Queens"
        autoComplete="address-level2"
        required
      />

      <label htmlFor="state">State</label>
      <select
        id="state"
        name="state"
        value={stateCode}
        onChange={(e) => setStateCode(e.target.value)}
        required
      >
        <option value="">Select State</option>
        {STATES.map(({ code, name }) => (
          <option key={code} value={code}>
            {name}
          </option>
        ))}
      </select>

      <label htmlFor="zip">ZIP code</label>
      <input
        id="zip"
        name="zip"
        type="text"
        value={zip}
        onChange={(e) => setZip(e.target.value)}
        placeholder="11101"
        autoComplete="postal-code"
        inputMode="numeric"
        required
      />

      {fieldErrors.zip && <div className="error">{fieldErrors.zip}</div>}
      {fieldErrors.address && (
        <div className="error">{fieldErrors.address}</div>
      )}
    </>
  );
}
