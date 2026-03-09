import { STATES } from "./constants";

export function validateAddressFields({ street, city, stateCode, zip }) {
  const errors = {};
  const zipPattern = /^\d{5}$/;
  if (!zipPattern.test(zip.trim())) errors.zip = "Enter a 5 digit ZIP code.";
  if (!street.trim() || !city.trim() || !stateCode.trim())
    errors.address = "Street, city, and state are required.";
  return errors;
}

export function formatAddress({ street, city, stateCode, zip }) {
  return `${street.trim()}, ${city.trim()}, ${stateCode.trim()} ${zip.trim()}`;
}

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
