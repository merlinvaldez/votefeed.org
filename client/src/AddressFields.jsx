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
        name="address-line1"
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
        name="address-level2"
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
        name="address-level1"
        value={stateCode}
        onChange={(e) => setStateCode(e.target.value)}
        autoComplete="address-level1"
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
        name="postal-code"
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
